// Selector de color a pantalla completa con lupa.
//
// Congela la pantalla (como la interfaz de capturas): con un fondo animado detrás, el color que
// se elige tiene que ser exactamente el que se está viendo. Los colores se leen de la propia
// captura, no de la pantalla en directo, para que la lupa no se capture a sí misma.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Mtk from 'gi://Mtk';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

Gio._promisify(Shell.Screenshot.prototype, 'screenshot_stage_to_content');
Gio._promisify(Shell.Screenshot, 'composite_to_stream');

const DIAMETRO_LUPA = 184;   // px lógicos
const BORDE_LUPA = 4;
const ZOOM_MIN = 6;
const ZOOM_MAX = 32;
const SEPARACION_ETIQUETA = 10;

const aHex = ([r, g, b]) =>
    `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`;

// Los píxeles de una captura, en memoria. La captura mide lo que el escenario multiplicado por la
// mayor escala de los monitores; `escala` pasa de coordenadas de escenario a píxeles de la captura.
class Pixeles {
    constructor(pixbuf, anchoEscenario) {
        this.ancho = pixbuf.get_width();
        this.alto = pixbuf.get_height();
        this.escala = this.ancho / anchoEscenario;
        this._fila = pixbuf.get_rowstride();
        this._canales = pixbuf.get_n_channels();
        this._datos = pixbuf.read_pixel_bytes().toArray();
    }

    // [r, g, b] de un píxel de la captura; null si cae fuera
    en(x, y) {
        if (x < 0 || y < 0 || x >= this.ancho || y >= this.alto)
            return null;
        const i = y * this._fila + x * this._canales;
        return [this._datos[i], this._datos[i + 1], this._datos[i + 2]];
    }
}

const Lupa = GObject.registerClass(
class Lupa extends St.DrawingArea {
    _init(pixeles, zoom) {
        super._init({width: DIAMETRO_LUPA, height: DIAMETRO_LUPA});
        this._pixeles = pixeles;
        this.zoom = zoom;
        this.centro = [0, 0];
    }

    vfunc_repaint() {
        const cr = this.get_context();
        const [ancho] = this.get_surface_size();
        // La superficie va en píxeles reales: el zoom y los bordes se escalan con ella
        const k = ancho / DIAMETRO_LUPA;
        const c = ancho / 2;
        const radio = c - BORDE_LUPA * k;
        const lado = this.zoom * k;
        const mitad = Math.ceil(radio / lado) + 1;
        const [cx, cy] = this.centro;

        cr.save();
        cr.arc(c, c, radio, 0, 2 * Math.PI);
        cr.clip();
        cr.setSourceRGB(0.1, 0.1, 0.1);
        cr.paint();

        // El píxel central queda centrado en la lupa: es el que se elige
        const origen = c - lado / 2;
        for (let dy = -mitad; dy <= mitad; dy++) {
            for (let dx = -mitad; dx <= mitad; dx++) {
                const color = this._pixeles.en(cx + dx, cy + dy);
                if (!color)
                    continue;
                cr.setSourceRGB(color[0] / 255, color[1] / 255, color[2] / 255);
                // Algo más ancho que la celda para que no se vean costuras entre píxeles
                cr.rectangle(origen + dx * lado, origen + dy * lado, lado + 0.5, lado + 0.5);
                cr.fill();
            }
        }
        cr.restore();

        // Marca del píxel elegido, en negro y blanco para que se vea sobre cualquier color
        cr.setLineWidth(1.5 * k);
        cr.setSourceRGBA(0, 0, 0, 0.9);
        cr.rectangle(origen - 1.5 * k, origen - 1.5 * k, lado + 3 * k, lado + 3 * k);
        cr.stroke();
        cr.setSourceRGBA(1, 1, 1, 0.95);
        cr.rectangle(origen, origen, lado, lado);
        cr.stroke();

        // Aro exterior
        cr.setLineWidth(BORDE_LUPA * k);
        cr.setSourceRGB(1, 1, 1);
        cr.arc(c, c, c - BORDE_LUPA * k / 2, 0, 2 * Math.PI);
        cr.stroke();
        cr.setLineWidth(1 * k);
        cr.setSourceRGBA(0, 0, 0, 0.6);
        cr.arc(c, c, c - 0.5 * k, 0, 2 * Math.PI);
        cr.stroke();

        cr.$dispose();
    }
});

const Selector = GObject.registerClass(
class Selector extends St.Widget {
    _init(contenido, pixeles, zoom, alTerminar) {
        super._init({reactive: true});
        this._pixeles = pixeles;
        this._alTerminar = alTerminar;
        this._desfase = [0, 0];   // lo que se ha movido con las flechas, en px de la captura

        this.add_constraint(new Clutter.BindConstraint({
            source: global.stage,
            coordinate: Clutter.BindCoordinate.ALL,
        }));
        this.set_cursor_type(Clutter.CursorType.NONE);

        const congelada = new St.Widget({content: contenido});
        congelada.add_constraint(new Clutter.BindConstraint({
            source: global.stage,
            coordinate: Clutter.BindCoordinate.ALL,
        }));
        this.add_child(congelada);

        this._lupa = new Lupa(pixeles, zoom);
        this.add_child(this._lupa);

        this._muestra = new St.Widget({width: 14, height: 14, y_align: Clutter.ActorAlign.CENTER, y_expand: true});
        this._hex = new St.Label({y_align: Clutter.ActorAlign.CENTER, style: 'font-weight: bold; font-feature-settings: "tnum";'});
        this._etiqueta = new St.BoxLayout({
            style: 'background-color: rgba(20, 20, 20, 0.92); color: white; border-radius: 99px; padding: 5px 12px; spacing: 8px;',
        });
        this._etiqueta.add_child(new St.Icon({icon_name: 'color-select-symbolic', icon_size: 14}));
        this._etiqueta.add_child(this._muestra);
        this._etiqueta.add_child(this._hex);
        this.add_child(this._etiqueta);

        Main.uiGroup.add_child(this);
        Main.uiGroup.set_child_above_sibling(this, null);
        this._grab = Main.pushModal(this, {actionMode: Shell.ActionMode.POPUP});
        this._actualizar();
    }

    // Píxel de la captura bajo el puntero, con el ajuste fino de las flechas
    _pixel() {
        const [x, y] = global.get_pointer();
        const p = this._pixeles;
        return [
            Math.min(p.ancho - 1, Math.max(0, Math.floor(x * p.escala) + this._desfase[0])),
            Math.min(p.alto - 1, Math.max(0, Math.floor(y * p.escala) + this._desfase[1])),
        ];
    }

    _actualizar() {
        const pixel = this._pixel();
        const p = this._pixeles;
        const x = (pixel[0] + 0.5) / p.escala;
        const y = (pixel[1] + 0.5) / p.escala;

        this._lupa.centro = pixel;
        this._lupa.set_position(Math.round(x - DIAMETRO_LUPA / 2), Math.round(y - DIAMETRO_LUPA / 2));
        this._lupa.queue_repaint();

        const hex = aHex(p.en(...pixel));
        this._color = hex;
        this._hex.text = hex.toUpperCase();
        this._muestra.style = `background-color: ${hex}; border-radius: 7px; border: 1px solid rgba(255, 255, 255, 0.7);`;

        // Debajo de la lupa; encima si no cabe en el monitor
        const monitor = global.display.get_monitor_geometry(
            global.display.get_monitor_index_for_rect(new Mtk.Rectangle({
                x: Math.floor(x), y: Math.floor(y), width: 1, height: 1,
            })));
        const [, , anchoEtiqueta, altoEtiqueta] = this._etiqueta.get_preferred_size();
        let ey = y + DIAMETRO_LUPA / 2 + SEPARACION_ETIQUETA;
        if (ey + altoEtiqueta > monitor.y + monitor.height)
            ey = y - DIAMETRO_LUPA / 2 - SEPARACION_ETIQUETA - altoEtiqueta;
        const ex = Math.min(monitor.x + monitor.width - anchoEtiqueta,
            Math.max(monitor.x, x - anchoEtiqueta / 2));
        this._etiqueta.set_position(Math.round(ex), Math.round(ey));
    }

    _terminar(color) {
        if (this._terminado)
            return;
        this._terminado = true;
        const zoom = this._lupa.zoom;
        Main.popModal(this._grab);
        this.destroy();
        this._alTerminar({color, zoom});
    }

    cancelar() {
        this._terminar(null);
    }

    vfunc_motion_event() {
        this._actualizar();
        return Clutter.EVENT_STOP;
    }

    vfunc_button_press_event(evento) {
        if (evento.get_button() === Clutter.BUTTON_PRIMARY)
            this._terminar(this._color);
        else
            this._terminar(null);
        return Clutter.EVENT_STOP;
    }

    vfunc_scroll_event(evento) {
        let paso = 0;
        const direccion = evento.get_scroll_direction();
        if (direccion === Clutter.ScrollDirection.UP)
            paso = 2;
        else if (direccion === Clutter.ScrollDirection.DOWN)
            paso = -2;
        else if (direccion === Clutter.ScrollDirection.SMOOTH)
            paso = -Math.sign(evento.get_scroll_delta()[1]) * 2;
        if (paso) {
            this._lupa.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, this._lupa.zoom + paso));
            this._lupa.queue_repaint();
        }
        return Clutter.EVENT_STOP;
    }

    vfunc_key_press_event(evento) {
        const movimientos = {
            [Clutter.KEY_Left]: [-1, 0],
            [Clutter.KEY_Right]: [1, 0],
            [Clutter.KEY_Up]: [0, -1],
            [Clutter.KEY_Down]: [0, 1],
        };
        const tecla = evento.get_key_symbol();
        if (tecla === Clutter.KEY_Escape) {
            this._terminar(null);
        } else if ([Clutter.KEY_Return, Clutter.KEY_KP_Enter, Clutter.KEY_space].includes(tecla)) {
            this._terminar(this._color);
        } else if (movimientos[tecla]) {
            // Limitar el desfase a la pantalla: si no, al pasarse habría que volver atrás a ciegas
            const antes = this._pixel();
            this._desfase[0] += movimientos[tecla][0];
            this._desfase[1] += movimientos[tecla][1];
            const despues = this._pixel();
            if (antes[0] === despues[0])
                this._desfase[0] -= movimientos[tecla][0];
            if (antes[1] === despues[1])
                this._desfase[1] -= movimientos[tecla][1];
            this._actualizar();
        }
        return Clutter.EVENT_STOP;
    }
});

// Una elección de color: captura la pantalla y abre el selector.
export class SesionSelector {
    constructor(zoom) {
        this._zoom = zoom;
    }

    // Devuelve {color: '#rrggbb' o null si se cancela, zoom}
    async elegir() {
        const capturador = new Shell.Screenshot();
        const [contenido] = await capturador.screenshot_stage_to_content();
        const flujo = Gio.MemoryOutputStream.new_resizable();
        // Sin cursor: en la captura queda lo que hay debajo de él
        const pixbuf = await Shell.Screenshot.composite_to_stream(
            contenido.get_texture(), 0, 0, -1, -1, 1, null, 0, 0, 1, flujo);
        flujo.close(null);
        if (this._cancelada)
            return {color: null, zoom: this._zoom};

        const pixeles = new Pixeles(pixbuf, global.stage.width);
        return new Promise(resolver => {
            this._selector = new Selector(contenido, pixeles, this._zoom, resolver);
        });
    }

    cancelar() {
        this._cancelada = true;
        this._selector?.cancelar();
    }
}
