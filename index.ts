import { Server, Room, Client } from "colyseus";
const schema = require('@colyseus/schema');
const Schema = schema.Schema;
const MapSchema = schema.MapSchema;
const type = schema.type;
import http from "http";

// 1. UNIT KLASSE ERWEITERT (HP, Damage, MaxHP)
class Unit extends Schema {
    @type("string") id = "";
    @type("string") type = "";
    @type("number") x = 0;
    @type("number") z = 0;
    @type("string") ownerId = "";
    @type("number") speed = 0.1;
    
    // Neue Stats für Kampf
    @type("number") hp = 100;
    @type("number") maxHp = 100;
    @type("number") damage = 10;
    @type("number") attackRange = 1.5;
    @type("boolean") isFighting = false; // Für Animationen (später)
}

class Building extends Schema {
    @type("string") id = "";
    @type("string") type = "empty";
    @type("number") x = 0;
    @type("number") z = 0;
    @type("string") ownerId = "";
    @type("number") spawnTimer = 0;
    @type("number") spawnInterval = 3000;
}

class PlayerState extends Schema {
    @type("number") gold = 250;
}

class State extends Schema {
    @type({ map: Unit }) units = new MapSchema();
    @type({ map: Building }) buildings = new MapSchema();
    @type({ map: PlayerState }) players = new MapSchema();
}

class GameRoom extends Room {
    onCreate (options) {
        this.setState(new State());

        this.onMessage("upgradeBuilding", (client, data) => {
            const building = this.state.buildings.get(data.buildingId);
            const player = this.state.players.get(client.sessionId);
            
            if (building && player && building.ownerId === client.sessionId) {
                let cost = 0;
                // Balancing Werte
                if (data.newType === "rekrut") cost = 50;
                if (data.newType === "bogenschuetze") cost = 100;
                if (data.newType === "ritter") cost = 150;
                if (data.newType === "magier") cost = 250;

                if (player.gold >= cost) {
                    player.gold -= cost;
                    building.type = data.newType;
                }
            }
        });

        // Loop läuft 20 Mal pro Sekunde (50ms)
        this.setSimulationInterval((deltaTime) => this.update(deltaTime), 50);
    }

    onJoin (client) {
        this.state.players.set(client.sessionId, new PlayerState());
        // Einfache Logik: Erster Spieler links (-10), zweiter rechts (10)
        const zPos = (this.state.players.size === 1) ? -10 : 10;
        this.createBuildingSlots(client.sessionId, zPos);
    }

    createBuildingSlots(ownerId, zPos) {
        let b1 = new Building(); b1.id = ownerId + "_slot_1"; b1.x = -4; b1.z = zPos; b1.ownerId = ownerId;
        this.state.buildings.set(b1.id, b1);
        
        let b2 = new Building(); b2.id = ownerId + "_slot_2"; b2.x = 4; b2.z = zPos; b2.ownerId = ownerId;
        this.state.buildings.set(b2.id, b2);
    }

   update(deltaTime) {
        if (Date.now() % 1000 < 60) this.state.players.forEach(p => p.gold += 5);

        // 1. SPAWNING
        this.state.buildings.forEach((building) => {
            if (building.type === "empty") return;
            building.spawnTimer += deltaTime;
            if (building.spawnTimer >= building.spawnInterval) {
                this.spawnUnit(building);
                building.spawnTimer = 0;
            }
        });

        // 2. LOGIK LOOP
        this.state.units.forEach((unit) => {
            let enemyFound = null;

            // A. GEGNER SUCHE & KOLLISIONS-VERMEIDUNG (Separation)
            this.state.units.forEach((other) => {
                if (unit === other) return; // Nicht mit sich selbst prüfen

                let dx = unit.x - other.x;
                let dz = unit.z - other.z;
                let dist = Math.sqrt(dx*dx + dz*dz);

                // Separation: Wenn zu nah an FREUND, leicht wegdrücken
                if (unit.ownerId === other.ownerId) {
                    if (dist < 0.8) { // 0.8 ist der Mindestabstand
                        let pushForce = 0.05; // Wie stark sie drängeln
                        if (dist > 0) {
                            unit.x += (dx / dist) * pushForce;
                            unit.z += (dz / dist) * pushForce;
                        } else {
                            // Wenn exakt gleiche Position, zufällig schubsen
                            unit.x += (Math.random() - 0.5) * pushForce;
                            unit.z += (Math.random() - 0.5) * pushForce;
                        }
                    }
                } 
                // Kampf: Wenn GEGNER in Reichweite
                else {
                    if (dist <= unit.attackRange) {
                        enemyFound = other;
                    }
                }
            });

            // B. KAMPF oder BEWEGUNG
            if (enemyFound) {
                unit.isFighting = true;
                // Schaden austeilen
                enemyFound.hp -= (unit.damage * (deltaTime / 1000));
                
                if (enemyFound.hp <= 0) {
                    console.log(`Unit ${enemyFound.id} died!`); // Server Log Check
                    this.state.units.delete(enemyFound.id);
                }
            } else {
                unit.isFighting = false;
                
                // Einfache Bewegung zur Mitte (oder Gegnerseite)
                // Wir addieren minimale Separation, damit sie nicht schnurgerade laufen
                if (unit.z < -0.5) unit.z += unit.speed;
                else if (unit.z > 0.5) unit.z -= unit.speed;
            }
            
            // C. WORLD BOUNDS (Damit sie durch das Schubsen nicht von der Map fallen)
            if (unit.x < -6) unit.x = -6;
            if (unit.x > 6) unit.x = 6;
        });
    }
    }

    spawnUnit(building) {
        const unit = new Unit();
        unit.id = "u_" + Date.now() + "_" + Math.random();
        unit.type = building.type;
        unit.x = building.x;
        // Spawn etwas vor dem Gebäude, damit sie nicht drin stecken
        unit.z = (building.z < 0) ? building.z + 2 : building.z - 2;
        unit.ownerId = building.ownerId;

        // Stats setzen (Balancing)
        if (unit.type === "rekrut") { unit.hp = 100; unit.damage = 10; unit.speed = 0.1; }
        if (unit.type === "bogenschuetze") { unit.hp = 60; unit.damage = 20; unit.speed = 0.1; unit.attackRange = 4; } // Fernkampf
        if (unit.type === "ritter") { unit.hp = 250; unit.damage = 15; unit.speed = 0.05; } // Tank
        if (unit.type === "magier") { unit.hp = 80; unit.damage = 40; unit.speed = 0.08; unit.attackRange = 3; }

        this.state.units.set(unit.id, unit);
    }
}

const port = 3000;
const server = http.createServer((req, res) => { res.writeHead(200); res.end("Server Online"); });
const gameServer = new Server({ server: server });
gameServer.define("battle", GameRoom);
gameServer.listen(port);
