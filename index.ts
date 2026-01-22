import { Server, Room, Client } from "colyseus";
import { Schema, MapSchema, type } from "@colyseus/schema";
import http from "http";

// --- DATEN-MODELLE ---

class Unit extends Schema {
    @type("string") id: string = "";
    @type("string") type: string = ""; // "rekrut", "ritter", "bogenschuetze"
    @type("number") x: number = 0;
    @type("number") z: number = 0;
    @type("string") ownerId: string = "";
    @type("number") speed: number = 0.1;
}

class Building extends Schema {
    @type("string") id: string = "";
    @type("string") type: string = "empty"; // Startet als leerer Bauplatz
    @type("number") x: number = 0;
    @type("number") z: number = 0;
    @type("string") ownerId: string = "";
    @type("number") spawnTimer: number = 0;
    @type("number") spawnInterval: number = 3000; // Standard: 3 Sek
}

class PlayerState extends Schema {
    @type("number") gold: number = 100; // Startgold
}

class State extends Schema {
    @type({ map: Unit }) units = new MapSchema<Unit>();
    @type({ map: Building }) buildings = new MapSchema<Building>();
    @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
}

// --- SPIEL-LOGIK ---

class GameRoom extends Room<State> {
    fixedTimeStep = 50; 

    onCreate (options: any) {
        this.setState(new State());
        console.log("Lane Wars Modus gestartet!");

        // BEFEHL: Upgrade durchführen
        this.onMessage("upgradeBuilding", (client, data) => {
            // data = { buildingId: "...", newType: "ritter" }
            const building = this.state.buildings.get(data.buildingId);
            const player = this.state.players.get(client.sessionId);

            // Sicherheitschecks
            if (building && player && building.ownerId === client.sessionId) {
                
                // KOSTEN-LOGIK (Beispiel)
                let cost = 0;
                if (data.newType === "rekrut") cost = 50;
                if (data.newType === "bogenschuetze") cost = 100;
                if (data.newType === "ritter") cost = 150;

                if (player.gold >= cost) {
                    player.gold -= cost;           // Bezahlen
                    building.type = data.newType;  // Bauen
                    console.log("Upgrade erfolgreich:", data.newType);
                }
            }
        });

        this.setSimulationInterval((deltaTime) => this.update(deltaTime));
    }

    onJoin (client: Client) {
        console.log(client.sessionId, "beigetreten");
        
        // 1. Spieler-Status erstellen (Gold)
        this.state.players.set(client.sessionId, new PlayerState());

        // 2. Fest vorgegebene Gebäude zuweisen (Die "Lanes")
        // Wir erstellen einfach mal 2 Bauplätze pro Spieler
        this.createBuildingSlots(client.sessionId, -10); // Spieler 1 (unten)
    }

    createBuildingSlots(ownerId: string, zPos: number) {
        // Linker Slot
        let b1 = new Building();
        b1.id = ownerId + "_slot_1";
        b1.x = -4; 
        b1.z = zPos;
        b1.ownerId = ownerId;
        this.state.buildings.set(b1.id, b1);

        // Rechter Slot
        let b2 = new Building();
        b2.id = ownerId + "_slot_2";
        b2.x = 4;
        b2.z = zPos;
        b2.ownerId = ownerId;
        this.state.buildings.set(b2.id, b2);
    }

    update(deltaTime: number) {
        // 1. Gold Einkommen (alle 1 Sekunde +1 Gold)
        if (Date.now() % 1000 < 50) { // Einfacher Trick für 1 Sekunde
            this.state.players.forEach(p => p.gold += 1);
        }

        // 2. Gebäude Spawning
        this.state.buildings.forEach((building) => {
            if (building.type === "empty") return; // Leere Slots tun nichts

            building.spawnTimer += deltaTime;
            if (building.spawnTimer >= building.spawnInterval) {
                this.spawnUnit(building);
                building.spawnTimer = 0;
            }
        });

        // 3. Einheiten laufen
        this.state.units.forEach((unit) => {
            // Primitive KI: Laufe zur Mitte (Z=0) und dann zum Gegner
            // Hier vereinfacht: Laufe immer Richtung Z=0
            if (unit.z < 0) unit.z += unit.speed; // Team Unten läuft hoch
            if (unit.z > 0) unit.z -= unit.speed; // Team Oben läuft runter
        });
    }

    spawnUnit(building: Building) {
        const unit = new Unit();
        unit.id = "u_" + Date.now() + "_" + Math.random();
        unit.type = building.type;
        unit.x = building.x;
        unit.z = building.z + 1.5; // Kommt aus dem Gebäude raus
        unit.ownerId = building.ownerId;
        
        // Werte basierend auf Typ
        if (unit.type === "ritter") unit.speed = 0.05; // Langsam
        else unit.speed = 0.1; // Normal

        this.state.units.set(unit.id, unit);
    }
}

const port = 3000;
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end("Lane Wars Server Online");
});

const gameServer = new Server({ server: server });
gameServer.define("battle", GameRoom);
gameServer.listen(port);
console.log(`Server läuft auf Port ${port}`);