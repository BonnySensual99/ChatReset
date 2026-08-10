@echo off
title Administrador del Bot de Discord - Oracle Cloud
color 0B

:MENU
cls
echo =========================================================
echo       GESTOR AUTOMATIZADO - BOT DISCORD (ORACLE)
echo =========================================================
echo.
echo  [1] Modificar Token / Nombre del Canal (Formulario Windows)
echo  [2] Ver estado del Bot (pm2 status)
echo  [3] Ver logs en vivo (pm2 logs)
echo  [4] Reiniciar el Bot manualmente
echo  [5] Actualizar Bot desde GitHub (git pull)
echo  [6] Conectar a la consola SSH del servidor
echo  [7] Salir
echo.
echo =========================================================
set /p opcion="Elige una opcion (1-7): "

if "%opcion%"=="1" goto EDITAR_WINDOWS
if "%opcion%"=="2" goto ESTADO
if "%opcion%"=="3" goto LOGS
if "%opcion%"=="4" goto REINICIAR
if "%opcion%"=="5" goto GIT_PULL
if "%opcion%"=="6" goto CONECTAR
if "%opcion%"=="7" exit

goto MENU

:GIT_PULL
cls
echo Descargando ultimos cambios de GitHub e instalando en la VM...
ssh -t -i "C:\Users\marko\Downloads\ssh-key-2026-08-10.key" ubuntu@141.253.198.30 "cd ChatReset && git pull && npm install && pm2 restart discord-bot --update-env && pm2 status"
pause
goto MENU


:EDITAR_WINDOWS
cls
node config-env.js
echo.
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

:REINICIAR
cls
echo Reiniciando el bot en el servidor...
ssh -t -i "C:\Users\marko\Downloads\ssh-key-2026-08-10.key" ubuntu@141.253.198.30 "cd ChatReset && pm2 restart discord-bot && pm2 status"
pause
goto MENU

:CONECTAR
cls
echo Conectando al servidor...
ssh -t -i "C:\Users\marko\Downloads\ssh-key-2026-08-10.key" ubuntu@141.253.198.30 "cd ChatReset && exec bash -l"
pause
goto MENU
