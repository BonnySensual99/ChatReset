@echo off
title Administrador del Bot de Discord - Oracle Cloud
color 0B

:MENU
cls
echo =========================================================
echo       GESTOR AUTOMATIZADO - BOT DISCORD (ORACLE)
echo =========================================================
echo.
echo  [1] Conectar a la consola del servidor (SSH)
echo  [2] Editar archivo .env (Token, Nombre del canal, etc.)
echo  [3] Reiniciar el Bot (Aplicar cambios)
echo  [4] Ver estado del Bot (pm2 status)
echo  [5] Ver logs/consola en vivo (pm2 logs)
echo  [6] Salir
echo.
echo =========================================================
set /p opcion="Elige una opcion (1-6): "

if "%opcion%"=="1" goto CONECTAR
if "%opcion%"=="2" goto EDITAR_ENV
if "%opcion%"=="3" goto REINICIAR
if "%opcion%"=="4" goto ESTADO
if "%opcion%"=="5" goto LOGS
if "%opcion%"=="6" exit

goto MENU

:CONECTAR
cls
echo Conectando al servidor...
ssh -t -i "C:\Users\marko\Downloads\ssh-key-2026-08-10.key" ubuntu@141.253.198.30 "cd ChatReset && exec bash -l"
pause
goto MENU

:EDITAR_ENV
cls
echo =========================================================
echo   EDITANDO .ENV EN EL SERVIDOR
echo =========================================================
echo   Instrucciones:
echo   - Modifica los valores que quieras (Token, canal, etc.)
echo   - Para Guardar: Pulsa Ctrl + O y luego ENTER
echo   - Para Salir: Pulsa Ctrl + X
echo =========================================================
echo.
pause
ssh -t -i "C:\Users\marko\Downloads\ssh-key-2026-08-10.key" ubuntu@141.253.198.30 "cd ChatReset && nano .env && pm2 restart discord-bot"
echo.
echo =========================================================
echo ¡Archivo .env guardado y el Bot se ha REINICIADO solo!
echo =========================================================
pause
goto MENU

:REINICIAR
cls
echo Reiniciando el bot en el servidor...
ssh -t -i "C:\Users\marko\Downloads\ssh-key-2026-08-10.key" ubuntu@141.253.198.30 "cd ChatReset && pm2 restart discord-bot && pm2 status"
pause
goto MENU

:ESTADO
cls
echo Consultando estado del bot...
ssh -t -i "C:\Users\marko\Downloads\ssh-key-2026-08-10.key" ubuntu@141.253.198.30 "cd ChatReset && pm2 status"
pause
goto MENU

:LOGS
cls
echo Mostrando logs en tiempo real (Pulsa Ctrl+C para salir)...
ssh -t -i "C:\Users\marko\Downloads\ssh-key-2026-08-10.key" ubuntu@141.253.198.30 "cd ChatReset && pm2 logs discord-bot"
pause
goto MENU
