@echo off
title Conectando a Oracle Cloud...
color 0A
echo ===================================================
echo   CONECTANDO AUTOMATICAMENTE A ORACLE CLOUD (VPS)
echo ===================================================
echo.

:: Conectar por SSH e ir directo a la carpeta del bot mostrando el estado
ssh -t -i "C:\Users\marko\Downloads\ssh-key-2026-08-10.key" ubuntu@141.253.198.30 "cd ChatReset && pm2 status && exec bash -l"

