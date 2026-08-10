const fs = require('fs');
const readline = require('readline');
const { execSync } = require('child_process');

const SSH_KEY = "C:\\Users\\marko\\Downloads\\ssh-key-2026-08-10.key";
const SERVER_IP = "141.253.198.30";

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function askQuestion(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

async function main() {
    console.clear();
    console.log("=========================================================");
    echo = console.log;
    echo("      CONFIGURADOR RAPIDO DE BOT (DESDE WINDOWS)");
    echo("=========================================================\n");

    console.log("Descargando valores actuales del servidor...");
    let currentEnv = "";
    try {
        currentEnv = execSync(`ssh -i "${SSH_KEY}" ubuntu@${SERVER_IP} "cat ~/ChatReset/.env"`).toString();
    } catch (e) {
        console.log("No se pudo obtener el .env actual, introduciendo valores nuevos.");
    }

    // Extraer valores actuales
    let currentToken = (currentEnv.match(/DISCORD_TOKEN=(.*)/) || [])[1] || "";
    let currentChannel = (currentEnv.match(/CHANNEL_NAME=(.*)/) || [])[1] || "chat-diario";
    let currentTimezone = (currentEnv.match(/TIMEZONE=(.*)/) || [])[1] || "Europe/Madrid";
    let rawCron = (currentEnv.match(/CRON_SCHEDULE=(.*)/) || [])[1] || "0 0 * * *";
    let currentCron = rawCron.replace(/"/g, '').trim();

    console.log(`\nValores actuales:`);
    console.log(`- Token: ${currentToken ? currentToken.substring(0, 15) + "..." : "No configurado"}`);
    console.log(`- Canal a limpiar: ${currentChannel}`);
    console.log(`- Zona horaria: ${currentTimezone}`);
    console.log(`- Horario actual: ${currentCron}\n`);

    const newToken = await askQuestion(`1. Nuevo DISCORD_TOKEN (ENTER para mantener): `);
    const newChannel = await askQuestion(`2. Nuevo CHANNEL_NAME (ENTER para mantener [${currentChannel}]): `);
    const newTimezone = await askQuestion(`3. Nueva TIMEZONE (ENTER para mantener [${currentTimezone}]): `);

    console.log(`\n4. Selecciona la Frecuencia / Hora de Limpieza:`);
    console.log(`   [1] Todos los días a las 00:00 (Medianoche - PRODUCCIÓN)`);
    console.log(`   [2] Modo Prueba: Cada 5 segundos`);
    console.log(`   [3] Modo Prueba: Cada 1 minuto`);
    console.log(`   [4] Hora personalizada diaria (ej: escribir 18:30)`);
    console.log(`   [ENTER] Mantener actual (${currentCron})\n`);

    const scheduleOption = await askQuestion(`Elige opcion de horario (1-4 o ENTER): `);

    let finalCron = currentCron;

    if (scheduleOption.trim() === "1") {
        finalCron = "0 0 * * *";
    } else if (scheduleOption.trim() === "2") {
        finalCron = "*/5 * * * * *";
    } else if (scheduleOption.trim() === "3") {
        finalCron = "0 */1 * * * *";
    } else if (scheduleOption.trim() === "4") {
        const horaCustom = await askQuestion(`Escribe la hora exacta (formato HH:MM, ej 14:30): `);
        const parts = horaCustom.trim().split(':');
        if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
            finalCron = `${parseInt(parts[1])} ${parseInt(parts[0])} * * *`;
        } else {
            console.log("Formato no válido, manteniendo el horario anterior.");
        }
    }

    const finalToken = newToken.trim() || currentToken;
    const finalChannel = newChannel.trim() || currentChannel;
    const finalTimezone = newTimezone.trim() || currentTimezone;

    console.log(`\nHorario seleccionado: ${finalCron}`);
    console.log("Enviando cambios al servidor y reiniciando el bot...");

    const envContent = `DISCORD_TOKEN=${finalToken}\nCHANNEL_NAME=${finalChannel}\nTIMEZONE=${finalTimezone}\nCRON_SCHEDULE="${finalCron}"\n`;


    
    // Escribir archivo temporal local
    fs.writeFileSync('temp.env', envContent);

    try {
        // Copiar por SCP al servidor y reiniciar
        execSync(`scp -i "${SSH_KEY}" temp.env ubuntu@${SERVER_IP}:~/ChatReset/.env`);
        fs.unlinkSync('temp.env');
        console.log("Subida completada. Reiniciando bot...");
        const output = execSync(`ssh -i "${SSH_KEY}" ubuntu@${SERVER_IP} "cd ChatReset && pm2 restart discord-bot && pm2 status"`).toString();
        console.log("\n" + output);
        console.log("=========================================================");
        console.log("¡ÉXITO! El bot se ha actualizado y reiniciado en el servidor.");
        console.log("=========================================================");
    } catch (err) {
        console.error("Error al actualizar en el servidor:", err.message);
    }

    rl.close();
}

main();
