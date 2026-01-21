import { Server, Room, Client } from "colyseus";
import { Schema, type } from "@colyseus/schema";
import http from "http";

// 1. Der Spiel-Zustand (Was passiert gerade?)
// Hier speichern wir später Positionen von Einheiten
class State extends Schema {
    @type("string") myField = "Hallo Welt";
}

// 2. Der Spiel-Raum (Die Logik)
class GameRoom extends Room<State> {
    onCreate (options: any) {
        this.setState(new State());
        console.log("Ein neuer Kampf-Raum wurde erstellt!");

        this.onMessage("type", (client, message) => {
            // Hier kommt später die Logik (Einheiten bauen)
            console.log("Nachricht erhalten:", message);
        });
    }

    onJoin (client: Client, options: any) {
        console.log(client.sessionId, "ist dem Kampf beigetreten!");
    }
}

// 3. Der Server (Das technische Grundgerüst)
const port = 3000;
const server = http.createServer();
const gameServer = new Server({
    server: server,
});

// Wir registrieren den Raum unter dem Namen "battle"
gameServer.define("battle", GameRoom);

gameServer.listen(port);
console.log(`Barrack Brawl läuft auf Port ${port}`);