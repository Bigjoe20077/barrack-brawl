import { Server, Room, Client } from "colyseus";
const schema = require('@colyseus/schema');
const Schema = schema.Schema;
const MapSchema = schema.MapSchema;
const type = schema.type;
import http from "http";

// --- 1. DATEN STRUKTUREN ---

class Unit extends Schema {
    @type("string") id = "";
    @type("string") type = "";
    @type("number") x = 0;
    @type("number") z = 0;
    @type("string") ownerId = "";
    
    // Stats (WICHTIG: Das hat gefehlt!)
    @type("number") speed = 0.1;
    @type("number") hp = 100;
    @type("number") maxHp = 100;
    @type("number") damage = 10;
    @type("number") attackRange = 1.5;
    @type("boolean") isFighting = false;
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

// --- 2. SPIEL LOGIK ---

class GameRoom extends Room {
    onCreate (options) {
        this.setState(new State());

        // Listener: Gebäude Upgrade / Bauen
        this.onMessage("upgradeBuilding", (client, data) => {
            const building = this.state.buildings.get(data.buildingId);
            const player = this.state.players.get(client.sessionId);
            
            if (building && player && building.ownerId === client.sessionId) {
                let cost = 0;
                // Balancing
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

        // Game Loop (20 FPS / alle 50ms)
        this.setSimulationInterval((deltaTime) => this.update(deltaTime), 50);
    }

    onJoin (client) {
        this.state.players.set(client.sessionId, new PlayerState());
        
        // Zuweisung der Seite (Oben oder Unten)
        const zPos = (this.state.players.size === 1) ? -10 : 10;
        this.createBuildingSlots(client.sessionId, zPos);
        console.log(`Spieler ${client.sessionId} beigetreten. Seite: ${zPos}`);
    }

    createBuildingSlots(ownerId, zPos) {
        // Slot 1
        let b1 = new Building(); 
        b1.id = ownerId + "_slot_1"; 
        b1.x = -4; 
        b1.z = zPos; 
        b1.ownerId = ownerId;
        this.state.buildings.set(b1.id, b1);
        
        // Slot 2
        let b2 = new Building(); 
        b2.id = ownerId + "_slot_2"; 
        b2.x = 4; 
        b2.z = zPos; 
        b2.ownerId = ownerId;
        this.state.buildings.set(b2.id, b2);
    }

    update(deltaTime) {
        // Gold Einkommen (jede Sekunde ca. 5 Gold)
        if (Date.now() % 1000 < 60) this.state.players.forEach(p => p.gold += 5);

        // A. SPAWNING
        this.state.buildings.forEach((building) => {
            if (building.type === "empty") return;
            
            building.spawnTimer += deltaTime;
            if (building.spawnTimer >= building.spawnInterval) {
                this.spawnUnit(building);
                building.spawnTimer = 0;
            }
        });

        // B. EINHEITEN LOGIK
        this.state.units.forEach((unit) => {
            let enemyFound = null;

            // 1. Gegner suchen & Kollisions-Vermeidung (Soft Collision)
            this.state.units.forEach((other) => {
                if (unit === other) return; // Nicht selbst prüfen

                let dx = unit.x - other.x;
                let dz = unit.z - other.z;
                let dist = Math.sqrt(dx*dx + dz*dz);

                // Wenn gleiches Team -> Wegschubsen (damit sie nicht stapeln)
                if (unit.ownerId === other.ownerId) {
                    if (dist < 0.8) { 
                        let pushForce = 0.05; 
                        if (dist > 0) {
                            unit.x += (dx / dist) * pushForce;
                            unit.z += (dz / dist) * pushForce;
                        } else {
                            // Zufallsschubs bei exakter Überlappung
                            unit.x += (Math.random() - 0.5) * pushForce;
                            unit.z += (Math.random() - 0.5) * pushForce;
                        }
                    }
                } 
                // Wenn Gegner -> Prüfen ob in Reichweite
                else {
                    if (dist <= unit.attackRange) {
                        enemyFound = other;
                    }
                }
            });

            // 2. Aktion ausführen
            if (enemyFound) {
                // KAMPF
                unit.isFighting = true;
                // Schaden berechnen (angepasst an DeltaTime)
                enemyFound.hp -= (unit.damage * (deltaTime / 1000));
                
                // Tod prüfen
                if (enemyFound.hp <= 0) {
                    this.state.units.delete(enemyFound.id);
                }
            } else {
                // BEWEGUNG
                unit.isFighting = false;
                
                // Laufen zur Mitte (0)
                if (unit.z < -0.5) unit.z += unit.speed;
                else if (unit.z > 0.5) unit.z -= unit.speed;
            }

            // 3. Map Grenzen (damit sie nicht rausgeschubst werden)
            if (unit.x < -6) unit.x = -6;
            if (unit.x > 6) unit.x = 6;
        });
    }

    spawnUnit(building) {
        const unit = new Unit();
        unit.id = "u_" + Date.now() + "_" + Math.random();
        unit.type = building.type;
        unit.x = building.x;
        // Spawne leicht vor dem Gebäude
        unit.z = (building.z < 0) ? building.z + 2 : building.z - 2;
        unit.ownerId = building.ownerId;

        // Stats setzen
        if (unit.type === "rekrut") { 
            unit.maxHp = 100; unit.hp = 100; unit.damage = 10; unit.speed = 0.1; 
        } else if (unit.type === "bogenschuetze") { 
            unit.maxHp = 60; unit.hp = 60; unit.damage = 20; unit.speed = 0.1; unit.attackRange = 4; 
        } else if (unit.type === "ritter") { 
            unit.maxHp = 250; unit.hp = 250; unit.damage = 15; unit.speed = 0.05; 
        } else if (unit.type === "magier") { 
            unit.maxHp = 80; unit.hp = 80; unit.damage = 40; unit.speed = 0.08; unit.attackRange = 3; 
        }

        this.state.units.set(unit.id, unit);
    }
}

// --- 3. SERVER START ---
const port = 3000;
const server = http.createServer((req, res) => { res.writeHead(200); res.end("Server Online"); });
const gameServer = new Server({ server: server });

gameServer.define("battle", GameRoom);
gameServer.listen(port);
console.log(`Battle Server listening on port ${port}`);
