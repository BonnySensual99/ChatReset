# 🛠️ Comandos Utiles para Administrar el Bot (PM2)

## 🔌 Conectar con 1 Clic (Windows)
Solo haz **doble clic** en el archivo `conectar-servidor.bat` creado en esta carpeta. Se abrirá la consola y te conectará automáticamente al servidor VPS de Oracle.

---

## 📋 Comandos Útiles dentro del Servidor

Una vez conectado al servidor, puedes usar estos comandos sencillos:

### 1. Ver el estado del bot (saber si está encendido)
```bash
pm2 status
```

### 2. Ver la consola y mensajes en tiempo real (Logs)
```bash
pm2 logs discord-bot
```
*(Para salir de la vista de logs pulsa `Ctrl + C`).*

### 3. Reiniciar el bot (si cambias el archivo `.env` o el código)
```bash
pm2 restart discord-bot
```

### 4. Editar las variables del bot (Token, nombre del canal, etc.)
```bash
cd ChatReset
nano .env
```
*(Guarda con `Ctrl + O`, `Enter` y sal con `Ctrl + X`. Luego ejecuta `pm2 restart discord-bot`).*

---

## 🔄 ¿Cómo actualizar el bot en el servidor si hago cambios en GitHub?
Si editas o mejoras el código en GitHub, actualízalo en el servidor con estos 2 comandos:
```bash
cd ChatReset
git pull
pm2 restart discord-bot
```
