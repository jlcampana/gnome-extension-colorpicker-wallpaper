#!/usr/bin/env bash
# Instala o actualiza Fondo de color en tu usuario:
#
#   curl -fsSL https://raw.githubusercontent.com/jlcampana/gnome-extension-colorpicker-wallpaper/main/install.sh | bash
#
# Desde un clon instala esa copia; si no, descarga la rama main.
#
# Todo va dentro de main() para que bash lea el script entero antes de ejecutarlo
# (necesario con «curl | bash»: una descarga cortada no ejecuta medio script).
set -euo pipefail

REPO="${COLORPICKER_REPO:-jlcampana/gnome-extension-colorpicker-wallpaper}"
BRANCH="${COLORPICKER_BRANCH:-main}"
UUID="colorpicker-wallpaper@jlcampana.github.io"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
DEST="$DATA/gnome-shell/extensions/$UUID"
# Global: la trampa EXIT se ejecuta después de que main() haya terminado
TMP=""

info() { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m==>\033[0m %s\n' "$*" >&2; }
fail() { printf '\033[1;31m==>\033[0m %s\n' "$*" >&2; exit 1; }

main() {
    command -v glib-compile-schemas >/dev/null || fail "falta glib-compile-schemas (paquete libglib2.0-bin / glib2)"

    TMP="$(mktemp -d)"
    trap 'rm -rf "$TMP"' EXIT

    local src here=""
    # Con curl no hay archivo de script: entonces siempre se descarga
    if [[ -f ${BASH_SOURCE[0]:-} ]]; then
        here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    fi
    if [[ -n $here && -f $here/metadata.json ]] && grep -q "\"$UUID\"" "$here/metadata.json"; then
        src="$here"
        info "Instalando desde $src"
    else
        command -v curl >/dev/null || fail "falta curl"
        info "Descargando $REPO ($BRANCH)"
        mkdir "$TMP/src"
        curl -fsSL "https://codeload.github.com/$REPO/tar.gz/refs/heads/$BRANCH" |
            tar -xz -C "$TMP/src" --strip-components=1
        src="$TMP/src"
    fi

    # Se prepara aparte y se cambia al final: si algo falla, la versión instalada sigue intacta
    mkdir -p "$TMP/ext"
    cp -r "$src/metadata.json" "$src/extension.js" "$src/picker.js" "$src/schemas" "$TMP/ext/"
    glib-compile-schemas "$TMP/ext/schemas"
    mkdir -p "$(dirname "$DEST")"
    rm -rf "$DEST"
    mv "$TMP/ext" "$DEST"
    info "Instalada en $DEST"

    # Con Wayland, GNOME Shell no ve las extensiones nuevas hasta volver a entrar, así que se
    # añade directamente a la lista de activas.
    if command -v gsettings >/dev/null; then
        local enabled
        enabled="$(gsettings get org.gnome.shell enabled-extensions 2>/dev/null || echo "@as []")"
        if [[ $enabled != *"'$UUID'"* ]]; then
            if [[ $enabled == "@as []" || $enabled == "[]" ]]; then
                enabled="['$UUID']"
            else
                enabled="${enabled%]}, '$UUID']"
            fi
            gsettings set org.gnome.shell enabled-extensions "$enabled" ||
                warn "no se pudo activar: gnome-extensions enable $UUID"
        fi
    fi

    if [[ ${XDG_SESSION_TYPE:-} == wayland ]]; then
        info "Cierra sesión y vuelve a entrar para cargar esta versión."
    else
        info "Recarga GNOME Shell (Alt+F2, r) o cierra sesión y vuelve a entrar."
    fi
}

main "$@"
