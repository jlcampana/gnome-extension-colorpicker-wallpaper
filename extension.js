// Fondo de color: botón en Ajustes rápidos que abre un gotero con lupa (picker.js) y pone el color
// elegido como fondo de escritorio, en forma de imagen. Si la extensión de fondos animados está
// activa la desactiva, porque su vídeo taparía la imagen.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import GdkPixbuf from 'gi://GdkPixbuf';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {QuickMenuToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {SesionSelector} from './picker.js';

const ICONO = 'color-select-symbolic';
const ESQUEMA_FONDO = 'org.gnome.desktop.background';
const UUID_ANIMADO = 'animated-wallpaper@jlcampana.github.io';
const ESQUEMA_ANIMADO = 'org.gnome.shell.extensions.animated-wallpaper';
const LADO_IMAGEN = 256;      // el fondo se amplía a la pantalla: al ser liso no se nota
const ESPERA_MENU_MS = 250;   // a que se cierre el menú para que no salga en la captura

// Los ajustes de la extensión de fondos animados, si está instalada. Su esquema puede no estar en
// la ruta global: entonces se lee de la carpeta de la extensión, que puede cargarse después de esta.
class FondoAnimado {
    constructor(alCambiar) {
        this._resolver();
        this._alCambiar = alCambiar;   // desde aquí: quien la crea ya lee el estado al terminar
        if (!this._ajustes) {
            Main.extensionManager.connectObject('extension-state-changed',
                () => this._resolver(), this);
        }
    }

    _resolver() {
        if (this._ajustes)
            return;
        let esquema = Gio.SettingsSchemaSource.get_default().lookup(ESQUEMA_ANIMADO, true);
        if (!esquema) {
            const carpeta = Main.extensionManager.lookup(UUID_ANIMADO)?.dir.get_child('schemas');
            if (!carpeta?.query_exists(null))
                return;
            esquema = Gio.SettingsSchemaSource.new_from_directory(carpeta.get_path(),
                Gio.SettingsSchemaSource.get_default(), false).lookup(ESQUEMA_ANIMADO, false);
        }
        if (!esquema)
            return;
        this._ajustes = new Gio.Settings({settings_schema: esquema});
        this._ajustes.connectObject('changed::enabled', () => this._alCambiar?.(), this);
        Main.extensionManager.disconnectObject(this);
        this._alCambiar?.();
    }

    get activo() {
        return this._ajustes?.get_boolean('enabled') ?? false;
    }

    set activo(valor) {
        this._ajustes?.set_boolean('enabled', valor);
    }

    destroy() {
        Main.extensionManager.disconnectObject(this);
        this._ajustes?.disconnectObject(this);
    }
}

function carpetaImagenes() {
    return GLib.build_filenamev([GLib.get_user_data_dir(), 'colorpicker-wallpaper']);
}

function rutaImagen(hex) {
    return GLib.build_filenamev([carpetaImagenes(), `${hex.slice(1)}.png`]);
}

// Cada color tiene su archivo: si se reutilizara el nombre, el fondo no se recargaría
function crearImagen(hex) {
    const ruta = rutaImagen(hex);
    GLib.mkdir_with_parents(carpetaImagenes(), 0o755);
    const imagen = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, false, 8, LADO_IMAGEN, LADO_IMAGEN);
    imagen.fill((parseInt(hex.slice(1), 16) << 8 | 0xff) >>> 0);
    imagen.savev(ruta, 'png', [], []);
    return Gio.File.new_for_path(ruta).get_uri();
}

function borrarImagen(hex) {
    if (hex)
        GLib.unlink(rutaImagen(hex));
}

const BotonColor = GObject.registerClass(
class BotonColor extends QuickMenuToggle {
    _init(ext) {
        super._init({title: 'Fondo de color', iconName: ICONO, toggleMode: false});
        this._ajustes = ext.getSettings();
        this._fondo = new Gio.Settings({schema_id: ESQUEMA_FONDO});
        this._animado = new FondoAnimado(() => this._actualizar());

        this.menu.setHeader(ICONO, 'Fondo de color', 'Elige un color de la pantalla con el gotero');
        this.menu.addAction('Elegir color', () => this._elegir(), ICONO);
        this._restaurar = this.menu.addAction('Restaurar fondo anterior', () => this._volverAlAnterior(),
            'edit-undo-symbolic');

        this.connect('clicked', () => this._elegir());
        this._ajustes.connectObject('changed', () => this._actualizar(), this);
        this._fondo.connectObject('changed', () => this._actualizar(), this);
        this._actualizar();
    }

    // ¿Es el color lo que se está viendo de fondo?
    get _colorActivo() {
        const color = this._ajustes.get_string('color');
        return !!color && !this._animado.activo &&
            this._fondo.get_string('picture-uri-dark') === Gio.File.new_for_path(rutaImagen(color)).get_uri();
    }

    get _hayAnterior() {
        return this._ajustes.get_string('previous-uri') !== '';
    }

    _actualizar() {
        const activo = this._colorActivo;
        this.checked = activo;
        this.subtitle = activo ? this._ajustes.get_string('color').toUpperCase() : null;
        this._restaurar.visible = activo && this._hayAnterior;
    }

    async _elegir() {
        if (this._sesion)
            return;
        const sesion = this._sesion = new SesionSelector(this._ajustes.get_int('zoom'));
        Main.overview.hide();
        Main.panel.closeQuickSettings();
        try {
            await new Promise(resolver => {
                this._espera = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ESPERA_MENU_MS, () => {
                    this._espera = 0;
                    resolver();
                    return GLib.SOURCE_REMOVE;
                });
            });
            const {color, zoom} = await sesion.elegir();
            this._ajustes.set_int('zoom', zoom);
            if (color)
                this._aplicar(color);
        } catch (e) {
            logError(e, 'Fondo de color');
            Main.notifyError('Fondo de color', e.message);
        } finally {
            this._sesion = null;
        }
    }

    _aplicar(hex) {
        const uri = crearImagen(hex);
        const anterior = this._ajustes.get_string('color');

        // Lo que había se guarda solo si no era ya un color de esta extensión: así «Restaurar»
        // siempre vuelve al fondo de verdad, por muchos colores que se prueben seguidos.
        if (!this._colorPropio(this._fondo.get_string('picture-uri-dark'))) {
            this._ajustes.set_string('previous-uri', this._fondo.get_string('picture-uri'));
            this._ajustes.set_string('previous-uri-dark', this._fondo.get_string('picture-uri-dark'));
            this._ajustes.set_string('previous-options', this._fondo.get_string('picture-options'));
            this._ajustes.set_string('previous-primary-color', this._fondo.get_string('primary-color'));
            this._ajustes.set_boolean('previous-animated', this._animado.activo);
        } else if (this._animado.activo) {
            this._ajustes.set_boolean('previous-animated', true);
        }

        this._fondo.delay();
        this._fondo.set_string('picture-uri', uri);
        this._fondo.set_string('picture-uri-dark', uri);
        this._fondo.set_string('picture-options', 'zoom');
        this._fondo.set_string('primary-color', hex);
        this._fondo.set_string('color-shading-type', 'solid');
        this._fondo.apply();
        this._ajustes.set_string('color', hex);
        this._animado.activo = false;

        if (anterior !== hex)
            borrarImagen(anterior);
    }

    _colorPropio(uri) {
        return uri.startsWith(Gio.File.new_for_path(carpetaImagenes()).get_uri());
    }

    _volverAlAnterior() {
        const color = this._ajustes.get_string('color');
        this._fondo.delay();
        this._fondo.set_string('picture-uri', this._ajustes.get_string('previous-uri'));
        this._fondo.set_string('picture-uri-dark', this._ajustes.get_string('previous-uri-dark'));
        this._fondo.set_string('picture-options', this._ajustes.get_string('previous-options'));
        this._fondo.set_string('primary-color', this._ajustes.get_string('previous-primary-color'));
        this._fondo.apply();
        if (this._ajustes.get_boolean('previous-animated'))
            this._animado.activo = true;
        this._ajustes.set_string('previous-uri', '');
        this._ajustes.set_string('color', '');
        borrarImagen(color);
    }

    destroy() {
        if (this._espera)
            GLib.source_remove(this._espera);
        this._sesion?.cancelar();
        this._ajustes.disconnectObject(this);
        this._fondo.disconnectObject(this);
        this._animado.destroy();
        super.destroy();
    }
});

const Indicador = GObject.registerClass(
class Indicador extends SystemIndicator {
    _init(ext) {
        super._init();
        this.quickSettingsItems.push(new BotonColor(ext));
    }

    destroy() {
        this.quickSettingsItems.forEach(item => item.destroy());
        super.destroy();
    }
});

export default class FondoDeColor extends Extension {
    enable() {
        this._indicador = new Indicador(this);
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicador);
    }

    disable() {
        this._indicador?.destroy();
        this._indicador = null;
    }
}
