import { Server, Room, Client } from "colyseus";
import { Schema, type } from "@colyseus/schema";
import http from "http";

class State extends Schema {
    @type("string") myField = "Hallo Welt";
}

class GameRoom extends Room<State> {
    onCreate (options: any) {
        this.setState(new State());
        console.log("Ein neuer Kampf-Raum wurde erstellt!");

        this.onMessage("type", (client, message) => {
            console.log("Nachricht erhalten:", message);
        });
    }

    onJoin (client: Client, options: any) {
        console.log(client.sessionId, "ist dem Kampf beigetreten!");
    }
}

const port = 3000;
// Der Fix: Wir antworten dem Browser!
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end("Barrack Brawl Server ist ONLINE!");
});

const gameServer = new Server({
    server: server,
});

gameServer.define("battle", GameRoom);

gameServer.listen(port);
console.log(`Barrack Brawl läuft auf Port ${port}`);