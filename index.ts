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
    @type("number") health = 100; // NEU: Lebenspunkte der Burg
    @type("number") baseZ = 0;    // NEU: Wo steht seine Burg?
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
        
        // Seite zuweisen
        const zPos = (this.state.players.size === 1) ? -10 : 10;
        player.baseZ = zPos; // Speichern, wo der Spieler wohnt

        this.createBuildingSlots(client.sessionId, zPos);
        console.log(`Spieler ${client.sessionId} auf Seite ${zPos}`);
    }

    createBuildingSlots(ownerId, zPos) {
        let b1 = new Building(); b1.id = ownerId + "_slot_1"; b1.x = -4; b1.z = zPos; b1.ownerId = ownerId;
        this.state.buildings.set(b1.id, b1);
        let b2 = new Building(); b2.id = ownerId + "_slot_2"; b2.x = 4; b2.z = zPos; b2.ownerId = ownerId;
        this.state.buildings.set(b2.id, b2);
    }

    update(deltaTime) {
        // Gold
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

            // 1. Gegner suchen & Separation
            this.state.units.forEach((other) => {
                if (unit === other) return;
                let dx = unit.x - other.x;
                let dz = unit.z - other.z;
                let dist = Math.sqrt(dx*dx + dz*dz);

                if (unit.ownerId === other.ownerId) {
                    if (dist < 0.8) { 
                        let pushForce = 0.05; 
                        if (dist > 0) {
                            unit.x += (dx / dist) * pushForce;
                            unit.z += (dz / dist) * pushForce;
                        } else {
                            unit.x += (Math.random() - 0.5) * pushForce;
                            unit.z += (Math.random() - 0.5) * pushForce;
                        }
                    }
                } else {
                    if (dist <= unit.attackRange) enemyFound = other;
                }
            });

            // 2. Kampf oder Lauf
            if (enemyFound) {
                unit.isFighting = true;
                enemyFound.hp -= (unit.damage * (deltaTime / 1000));
                if (enemyFound.hp <= 0) this.state.units.delete(enemyFound.id);
            } else {
                unit.isFighting = false;
                if (unit.z < -0.5) unit.z += unit.speed;
                else if (unit.z > 0.5) unit.z -= unit.speed;
            }

            // 3. Map Grenzen & BASESCHADEN (NEU!)
            if (unit.x < -6) unit.x = -6;
            if (unit.x > 6) unit.x = 6;

            // Hat Einheit das Ende erreicht?
            // "Oben" ist bei Z = -10 (Player 1), "Unten" ist bei Z = 10 (Player 2)
            // Wenn Einheit bei > 9 ist -> Schaden an Player 2 (Unten)
            if (unit.z > 9) {
                this.damagePlayerAtPosition(10, 10); // 10 Schaden an Spieler bei Z=10
                this.state.units.delete(unit.id); // Einheit opfert sich
            }
            // Wenn Einheit bei < -9 ist -> Schaden an Player 1 (Oben)
            else if (unit.z < -9) {
                this.damagePlayerAtPosition(-10, 10); // 10 Schaden an Spieler bei Z=-10
                this.state.units.delete(unit.id);
            }
        });
    }

    damagePlayerAtPosition(zPos, damage) {
        this.state.players.forEach((player, sessionId) => {
            // Wir suchen den Spieler, der an dieser Base wohnt
            // Toleranzbereich prüfen, da zPos exakt -10 oder 10 ist
            if (Math.abs(player.baseZ - zPos) < 1) {
                player.health -= damage;
                console.log(`Spieler ${sessionId} hat Schaden genommen! HP: ${player.health}`);
                
                if (player.health <= 0) {
                    // GAME OVER LOGIK (Simpel: Reset HP)
                    console.log("GAME OVER für " + sessionId);
                    player.health = 100; // Oder disconnecten / Reset Room
                    // Hier könnte man später "broadcast('gameOver')" senden
                }
            }
        });
    }

    spawnUnit(building) {
        const unit = new Unit();
        unit.id = "u_" + Date.now() + "_" + Math.random();
        unit.type = building.type;
        unit.x = building.x;
        unit.z = (building.z < 0) ? building.z + 2 : building.z - 2;
        unit.ownerId = building.ownerId;

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
