import { Server, Room, Client } from "colyseus";
const schema = require('@colyseus/schema');
const Schema = schema.Schema;
const MapSchema = schema.MapSchema;
const type = schema.type;
import http from "http";

class Unit extends Schema {
    @type("string") id = "";
    @type("string") type = "";
    @type("number") x = 0;
    @type("number") z = 0;
    @type("string") ownerId = "";
    @type("number") speed = 0.1;
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
        this.state.players.set(client.sessionId, new PlayerState());
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
        this.state.buildings.forEach((building) => {
            if (building.type === "empty") return;
            building.spawnTimer += deltaTime;
            if (building.spawnTimer >= building.spawnInterval) {
                this.spawnUnit(building);
                building.spawnTimer = 0;
            }
        });
        this.state.units.forEach((unit) => {
            if (unit.z < -1) unit.z += unit.speed;
            else if (unit.z > 1) unit.z -= unit.speed;
        });
    }
    spawnUnit(building) {
        const unit = new Unit();
        unit.id = "u_" + Date.now() + "_" + Math.random();
        unit.type = building.type;
        unit.x = building.x;
        unit.z = (building.z < 0) ? building.z + 2 : building.z - 2;
        unit.ownerId = building.ownerId;
        if (unit.type === "ritter") unit.speed = 0.05;
        else if (unit.type === "magier") unit.speed = 0.04;
        else unit.speed = 0.1;
        this.state.units.set(unit.id, unit);
    }
}
const port = 3000;
const server = http.createServer((req, res) => { res.writeHead(200); res.end("Server Online"); });
const gameServer = new Server({ server: server });
gameServer.define("battle", GameRoom);
gameServer.listen(port);
