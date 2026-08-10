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

    console.log(`\nValores actuales:`);
    console.log(`- Token: ${currentToken ? currentToken.substring(0, 15) + "..." : "No configurado"}`);
    console.log(`- Canal a limpiar: ${currentChannel}`);
    console.log(`- Zona horaria: ${currentTimezone}\n`);

    const newToken = await askQuestion(`Nuevo DISCORD_TOKEN (Pulsa ENTER para mantener el actual): `);
    const newChannel = await askQuestion(`Nuevo CHANNEL_NAME (Pulsa ENTER para mantener [${currentChannel}]): `);
    const newTimezone = await askQuestion(`Nueva TIMEZONE (Pulsa ENTER para mantener [${currentTimezone}]): `);

    const finalToken = newToken.trim() || currentToken;
    const finalChannel = newChannel.trim() || currentChannel;
    const finalTimezone = newTimezone.trim() || currentTimezone;

    console.log("\nEnviando cambios al servidor y reiniciando el bot...");

    const envContent = `DISCORD_TOKEN=${finalToken}\nCHANNEL_NAME=${finalChannel}\nTIMEZONE=${finalTimezone}\n`;
    
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
