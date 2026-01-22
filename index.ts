import { Server, Room, Client } from "colyseus";
import { Schema, MapSchema, type } from "@colyseus/schema";
import http from "http";

// --- DATEN-MODELLE ---

class Unit extends Schema {
    @type("string") id: string = "";
    @type("string") type: string = ""; // "rekrut", "ritter", "bogenschuetze", "magier"
    @type("number") x: number = 0;
    @type("number") z: number = 0;
    @type("string") ownerId: string = "";
    @type("number") speed: number = 0.1;
}

class Building extends Schema {
    @type("string") id: string = "";
    @type("string") type: string = "empty"; // Startet leer
    @type("number") x: number = 0;
    @type("number") z: number = 0;
    @type("string") ownerId: string = "";
    @type("number") spawnTimer: number = 0;
    @type("number") spawnInterval: number = 3000; // Alle 3 Sekunden
}

class PlayerState extends Schema {
    @type("number") gold: number = 250; // Etwas Startgold zum Testen
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
        console.log("Pocket Castle Wars Server gestartet!");

        // --- UPGRADE HANDLER ---
        this.onMessage("upgradeBuilding", (client, data) => {
            const building = this.state.buildings.get(data.buildingId);
            const player = this.state.players.get(client.sessionId);

            if (building && player && building.ownerId === client.sessionId) {
                
                // PREISLISTE
                let cost = 0;
                if (data.newType === "rekrut") cost = 50;
                if (data.newType === "bogenschuetze") cost = 100;
                if (data.newType === "ritter") cost = 150;
                if (data.newType === "magier") cost = 250;

                // KAUFEN
                if (player.gold >= cost) {
                    player.gold -= cost;
                    building.type = data.newType; 
                    console.log(`Upgrade auf ${data.newType} durchgeführt.`);
                }
            }
        });

        this.setSimulationInterval((deltaTime) => this.update(deltaTime));
    }

    onJoin (client: Client) {
        this.state.players.set(client.sessionId, new PlayerState());
        
        // Erstelle 2 Bauplätze pro Spieler (Position abhängig von ID)
        // Einfacher Hack: Erster Spieler Z=-10, Zweiter Z=10
        const zPos = (this.state.players.size === 1) ? -10 : 10;
        this.createBuildingSlots(client.sessionId, zPos);
    }

    createBuildingSlots(ownerId: string, zPos: number) {
        // Slot 1 (Links)
        let b1 = new Building();
        b1.id = ownerId + "_slot_1";
        b1.x = -4; b1.z = zPos; b1.ownerId = ownerId;
        this.state.buildings.set(b1.id, b1);

        // Slot 2 (Rechts)
        let b2 = new Building();
        b2.id = ownerId + "_slot_2";
        b2.x = 4; b2.z = zPos; b2.ownerId = ownerId;
        this.state.buildings.set(b2.id, b2);
    }

    update(deltaTime: number) {
        // 1. Passives Einkommen (alle ~1 Sekunde)
        if (Date.now() % 1000 < 60) {
            this.state.players.forEach(p => p.gold += 5); // 5 Gold pro Sekunde
        }

        // 2. Gebäude Spawning
        this.state.buildings.forEach((building) => {
            if (building.type === "empty") return;

            building.spawnTimer += deltaTime;
            if (building.spawnTimer >= building.spawnInterval) {
                this.spawnUnit(building);
                building.spawnTimer = 0;
            }
        });

        // 3. Einheiten Bewegung (Automatisch zur Mitte / zum Gegner)
        this.state.units.forEach((unit) => {
            // Logik: Wenn ich unten starte (Z < 0), laufe nach oben (+). Sonst umgekehrt.
            // Wir speichern die Startrichtung basierend auf dem Owner später besser, 
            // aber für jetzt reicht die Position.
            if (unit.z < -1) unit.z += unit.speed;      // Team Unten läuft hoch
            else if (unit.z > 1) unit.z -= unit.speed;  // Team Oben läuft runter
            // (Zwischen -1 und 1 ist die Kampfzone, da bleiben sie stehen -> später Kampflogik)
        });
    }

    spawnUnit(building: Building) {
        const unit = new Unit();
        unit.id = "u_" + Date.now() + "_" + Math.random();
        unit.type = building.type;
        unit.x = building.x;
        // Spawnt leicht versetzt vor dem Gebäude, damit sie nicht drin stecken
        unit.z = (building.z < 0) ? building.z + 2 : building.z - 2; 
        unit.ownerId = building.ownerId;
        
        // GESCHWINDIGKEITEN
        if (unit.type === "ritter") unit.speed = 0.05; // Tank (Langsam)
        else if (unit.type === "magier") unit.speed = 0.04; // Magier (Sehr Langsam)
        else unit.speed = 0.1; // Rekrut & Archer (Normal)

        this.state.units.set(unit.id, unit);
    }
}

const port = 3000;
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end("Pocket Castle Wars Server Online");
});
const gameServer = new Server({ server: server });
gameServer.define("battle", GameRoom);
gameServer.listen(port);
console.log(`Server läuft auf Port ${port}`);