# Fondo de color

Extensión de GNOME Shell: un botón en Ajustes rápidos abre un gotero con lupa para elegir cualquier color de la pantalla y ponerlo como fondo de escritorio.

## Instalar o actualizar

```bash
curl -fsSL https://raw.githubusercontent.com/jlcampana/gnome-extension-colorpicker-wallpaper/main/install.sh | bash
```

El mismo comando sirve para instalar y para actualizar. Después hay que cerrar sesión y volver a entrar. Desde un clon: `./install.sh`.

## Uso

Pulsa **Fondo de color** en Ajustes rápidos. La pantalla se congela y aparece la lupa sobre el puntero.

| Acción | Control |
|---|---|
| Elegir el color | Clic izquierdo, Intro o Espacio |
| Mover un píxel | Flechas |
| Cambiar el zoom | Rueda del ratón |
| Cancelar | Esc o clic derecho |

El color se guarda como imagen y se pone de fondo. Si la extensión [Fondos animados](https://github.com/jlcampana/gnome-animated-wallpaper) está activa, se desactiva. **Restaurar fondo anterior**, en la flecha del botón, devuelve el fondo y el vídeo que había.
