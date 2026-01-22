import { Server, Room, Client } from "colyseus";
const schema = require('@colyseus/schema');
const Schema = schema.Schema;
const MapSchema = schema.MapSchema;
const type = schema.type;
import http from "http";

// --- DATEN STRUKTUREN ---

class Unit extends Schema {
    @type("string") id = "";
    @type("string") type = "";
    @type("number") x = 0;
    @type("number") z = 0;
    @type("string") ownerId = "";
    @type("number") speed = 0.1;
    @type("number") hp = 100;
    @type("number") maxHp = 100;
    @type("number") damage = 10;
    @type("number") attackRange = 1.5;
    @type("boolean") isFighting = false;
    
    // NEU: Richtung (-1 oder 1)
    @type("number") direction = 1; 
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
    @type("number") health = 100;
    @type("number") baseZ = 0;
}

class State extends Schema {
    @type({ map: Unit }) units = new MapSchema();
    @type({ map: Building }) buildings = new MapSchema();
    @type({ map: PlayerState }) players = new MapSchema();
}

// --- SPIEL LOGIK ---

class GameRoom extends Room {
    onCreate (options) {
        this.setState(new State());

        this.onMessage("upgradeBuilding", (client, data) => {
            const building = this.state.buildings.get(data.buildingId);
            const player = this.state.players.get(client.sessionId);
            
            if (building && player && building.ownerId === client.sessionId) {
                let cost = 0;
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

        this.setSimulationInterval((deltaTime) => this.update(deltaTime), 50);
    }

    onJoin (client) {
        let player = new PlayerState();
        this.state.players.set(client.sessionId, player);
        const zPos = (this.state.players.size === 1) ? -10 : 10;
        player.baseZ = zPos; 
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

        // SPAWNING
        this.state.buildings.forEach((building) => {
            if (building.type === "empty") return;
            building.spawnTimer += deltaTime;
            if (building.spawnTimer >= building.spawnInterval) {
                this.spawnUnit(building);
                building.spawnTimer = 0;
            }
        });

        // UNIT LOGIK ("KI")
        this.state.units.forEach((unit) => {
            let target = null;
            let closestDist = 999;

            // 1. SCAN: Suche nach Gegnern (für Angriff ODER Verfolgung)
            this.state.units.forEach((other) => {
                if (unit === other) return;
                
                let dx = unit.x - other.x;
                let dz = unit.z - other.z;
                let dist = Math.sqrt(dx*dx + dz*dz);

                // A. Separation (Nicht stapeln mit Freunden)
                if (unit.ownerId === other.ownerId) {
                    if (dist < 0.8) { 
                        let push = 0.05; 
                        if (dist > 0) {
                            unit.x += (dx / dist) * push;
                            unit.z += (dz / dist) * push;
                        } else {
                            unit.x += (Math.random() - 0.5) * push;
                            unit.z += (Math.random() - 0.5) * push;
                        }
                    }
                } 
                // B. Gegner finden
                else {
                    // Wir merken uns den NÄCHSTEN Gegner
                    if (dist < closestDist) {
                        closestDist = dist;
                        target = other;
                    }
                }
            });

            // 2. ENTSCHEIDUNG: Kämpfen, Verfolgen oder Basis stürmen?
            
            // Sicht-Radius (Aggro Range): 6 Einheiten
            // Angriffs-Radius: unit.attackRange
            
            if (target && closestDist <= unit.attackRange) {
                // FALL 1: Gegner in Waffenreichweite -> KÄMPFEN
                unit.isFighting = true;
                target.hp -= (unit.damage * (deltaTime / 1000));
                if (target.hp <= 0) this.state.units.delete(target.id);
            
            } else if (target && closestDist <= 6) {
                // FALL 2: Gegner gesehen (aber zu weit weg) -> VERFOLGEN ("Aggro")
                unit.isFighting = false;
                
                // Vektor zum Gegner berechnen
                let dx = target.x - unit.x;
                let dz = target.z - unit.z;
                
                // Normalisieren (damit wir nicht schneller werden)
                let len = Math.sqrt(dx*dx + dz*dz);
                dx /= len;
                dz /= len;

                // Bewegen
                unit.x += dx * unit.speed;
                unit.z += dz * unit.speed;

            } else {
                // FALL 3: Kein Gegner weit und breit -> STURM AUF DIE BASIS
                unit.isFighting = false;
                
                // Wir laufen einfach geradeaus in unsere definierte 'direction'
                unit.z += unit.speed * unit.direction;

                // Kleiner "Drift" zurück zur Mitte der Lane (X=0), damit sie nicht am Rand kleben
                // Wenn x > 0.5, geh leicht nach links. Wenn x < -0.5, geh leicht nach rechts.
                if (unit.x > 2) unit.x -= 0.02;
                if (unit.x < -2) unit.x += 0.02;
            }

            // 3. World Bounds & Base Damage
            if (unit.x < -6) unit.x = -6;
            if (unit.x > 6) unit.x = 6;

            // Win Condition Check
            if (unit.z > 11 || unit.z < -11) {
                // Zähle Schaden, wenn sie tief in die Gegner-Zone eindringen
                // Da direction 1 = nach unten (zu +10) und -1 = nach oben (zu -10)
                let enemyBaseZ = (unit.direction === 1) ? 10 : -10;
                this.damagePlayerAtPosition(enemyBaseZ, 10);
                this.state.units.delete(unit.id);
            }
        });
    }

    damagePlayerAtPosition(zPos, damage) {
        this.state.players.forEach((player, sessionId) => {
            if (Math.abs(player.baseZ - zPos) < 2) {
                player.health -= damage;
                console.log(`Base Treffer! Spieler ${sessionId} HP: ${player.health}`);
                if (player.health <= 0) {
                    console.log("GAME OVER");
                    player.health = 100; 
                }
            }
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

        // RICHTUNG BESTIMMEN
        // Wenn Gebäude oben (z < 0) -> Lauf nach unten (+1)
        // Wenn Gebäude unten (z > 0) -> Lauf nach oben (-1)
        unit.direction = (building.z < 0) ? 1 : -1;

        if (unit.type === "rekrut") { unit.maxHp = 100; unit.hp = 100; unit.damage = 10; unit.speed = 0.1; }
        else if (unit.type === "bogenschuetze") { unit.maxHp = 60; unit.hp = 60; unit.damage = 20; unit.speed = 0.1; unit.attackRange = 4; }
        else if (unit.type === "ritter") { unit.maxHp = 250; unit.hp = 250; unit.damage = 15; unit.speed = 0.05; }
        else if (unit.type === "magier") { unit.maxHp = 80; unit.hp = 80; unit.damage = 40; unit.speed = 0.08; unit.attackRange = 3; }

        this.state.units.set(unit.id, unit);
    }
}

const port = 3000;
const server = http.createServer((req, res) => { res.writeHead(200); res.end("Server Online"); });
const gameServer = new Server({ server: server });
gameServer.define("battle", GameRoom);
gameServer.listen(port);
