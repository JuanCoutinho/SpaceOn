import { AudioSys } from './AudioSystem';
import { networkManager } from './NetworkManager';

export function createGameEngine(canvas, callbacks, multiConfig = { active: false, isHost: false }, playerName = "Unknown") {
    const ctx = canvas.getContext('2d', { alpha: false });
    let width, height;

    let gameState = 'START';
    let colonizedPlanet = null; // Reference to the planet being lived on
    let score = 0;
    let zoom = 1, targetZoom = 1;
    let camera = { x: 0, y: 0, shakeX: 0, shakeY: 0, shakeIntensity: 0 };

    const keys = { w: false, a: false, s: false, d: false, mouse: false, rightMouse: false, c: false, space: false, e: false, b: false };
    let mouseScreen = { x: 0, y: 0 };
    let playerSurfaceAngle = 0; // angle of player on colonized planet circumference

    // Building types for colony
    const BUILDING_TYPES = {
        FARM: { name: 'Fazenda 🌾', cost: { leaves: 3, fruits: 2 }, color: '#00ff66', produces: 'food', ratePerTick: 0.025, h: 40 },
        PURIFIER: { name: 'Purificador 💧', cost: { ice: 4 }, color: '#4287ff', produces: 'water', ratePerTick: 0.03, h: 45 },
        GENERATOR: { name: 'Gerador ⚡', cost: { minerals: 5 }, color: '#ffaa00', produces: 'hull', ratePerTick: 0.015, h: 38 },
        TURRET: { name: 'Torreta 🔫', cost: { minerals: 3, scrap: 3 }, color: '#ff2a5f', produces: null, ratePerTick: 0, h: 32, range: 700, damage: 25, fireRate: 90 },
    };

    let planets = [], suns = [], worms = [], blackHoles = [], wormholes = [], projectiles = [], gravityWaves = [], particles = [], floatingTexts = [], pirates = [], debris = [];
    let backgroundStars = [];
    let extractionTarget = null;
    let extractorParticles = []; // Novas partículas de Gamefeel ("+1 Gelo")

    let player = null;
    let connectedPeers = {}; // { 'peerId': { data, obj } }

    let stats = {
        level: 1, xp: 0, xpNext: 50,
        dmgMult: 1.0, fireRate: 600, multishot: 1,
        speed: 1.0, recoil: 1.0,
        shield: 100, maxShield: 100,
        food: 100, maxFood: 100,
        water: 100, maxWater: 100,
        hull: 100, maxHull: 100,
        inv: { ice: 0, leaves: 0, fruits: 0, minerals: 0, scrap: 0 },
        upgrades: { homing: false, explosive: false, combatDrones: false, repairDrones: false, hyperdrive: false, scanner: false, cloak: false, flares: false },
        laserMode: 'EXTRACT'
    };
    let lastShotTime = 0;
    let cloakTimer = 0;
    let flares = [];

    const BIOMES = {
        ALPHA: { name: "Setor Alpha", maxDist: 4000, bg: '#030308', dustColor: '#ffffff' },
        NEBULA: { name: "Nebulosa Tóxica", maxDist: 9000, bg: '#1a0524', dustColor: '#ff00ff' },
        ABYSS: { name: "O Abismo", maxDist: Infinity, bg: '#050000', dustColor: '#ff2a5f' }
    };

    function getCurrentBiome(x, y) {
        let dist = Math.hypot(x, y);
        if (dist < BIOMES.ALPHA.maxDist) return BIOMES.ALPHA;
        if (dist < BIOMES.NEBULA.maxDist) return BIOMES.NEBULA;
        return BIOMES.ABYSS;
    }

    function triggerShake(intensity) {
        camera.shakeIntensity = Math.min(camera.shakeIntensity + intensity, 40);
    }

    function syncHUD(alertWorm = false) {
        if (!player) return;
        const biome = getCurrentBiome(player.x, player.y);
        callbacks.onUpdateHUD({
            score: Math.floor(score),
            level: stats.level, xp: stats.xp, xpNext: stats.xpNext,
            weaponStr: `Dano: ${(2 * stats.dmgMult).toFixed(1)} | Tiros: ${stats.multishot}`,
            biomeName: biome.name, biomeColor: biome.dustColor,
            showWormAlert: alertWorm,
            shield: stats.shield, maxShield: stats.maxShield,
            food: stats.food, maxFood: stats.maxFood,
            water: stats.water, maxWater: stats.maxWater,
            hull: stats.hull, maxHull: stats.maxHull,
            inv: { ...stats.inv },
            laserMode: stats.laserMode
        });
    }

    function resolveCollision(a, b, restitution = 0.5) {
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist = Math.hypot(dx, dy);
        if (dist === 0) return;

        let nx = dx / dist;
        let ny = dy / dist;
        let rvx = b.vx - a.vx;
        let rvy = b.vy - a.vy;
        let velAlongNormal = rvx * nx + rvy * ny;
        if (velAlongNormal > 0) return;

        let massA = a.radius ? a.radius * a.radius : 400;
        let massB = b.mass ? b.mass : (b.radius * b.radius);

        let j = -(1 + restitution) * velAlongNormal;
        j /= (1 / massA + 1 / massB);

        a.vx -= (j * nx) / massA;
        a.vy -= (j * ny) / massA;
        b.vx += (j * nx) / massB;
        b.vy += (j * ny) / massB;

        if (a === player) {
            takeDamage(Math.min(15, (j / massA) * 2));
        }
    }

    let lastCombatTime = 0;
    function takeDamage(amount) {
        lastCombatTime = Date.now();
        if (stats.shield > 0) {
            if (amount > stats.shield) {
                let remainder = amount - stats.shield;
                stats.shield = 0;
                stats.hull -= remainder;
            } else {
                stats.shield -= amount;
            }
        } else {
            stats.hull -= amount;
        }
        syncHUD();
        if (stats.hull <= 0) die("Casco totalmente destruído em combate.");
    }

    class ExtractorParticle {
        constructor(x, y, type, color, amount) {
            this.x = x; this.y = y;
            this.type = type; this.color = color; this.amount = amount;
            this.life = 1.0;
        }
        draw() {
            ctx.save();
            ctx.font = '700 14px Orbitron';
            ctx.fillStyle = this.color;
            ctx.textAlign = 'center';
            ctx.fillText(`+${this.amount} ${this.type}`, this.x, this.y - 15);
            ctx.beginPath();
            ctx.arc(this.x, this.y, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
        update() {
            // Voa em direção à nave (Mecânica Gamefeel)
            let dx = player.x - this.x;
            let dy = player.y - this.y;
            let dist = Math.hypot(dx, dy);

            if (dist < 20) {
                // Chegou na nave
                if (this.type === 'GELO') stats.inv.ice += this.amount;
                if (this.type === 'FOLHAS') stats.inv.leaves += this.amount;
                if (this.type === 'FRUTAS') stats.inv.fruits += this.amount;
                if (this.type === 'MINÉRIO') stats.inv.minerals += this.amount;
                if (this.type === 'SUCATA') stats.inv.scrap += this.amount;
                AudioSys.playTone(800 + Math.random() * 400, 'sine', 0.05, 0.1, 1500);
                syncHUD();
                this.life = 0;
            } else {
                let speed = Math.max(15, dist * 0.1);
                this.x += (dx / dist) * speed;
                this.y += (dy / dist) * speed;
            }
            this.draw();
        }
    }

    class Player {
        constructor() {
            this.x = 0; this.y = 0;
            this.vx = 0; this.vy = 0;
            this.radius = 25;
            this.angle = -Math.PI / 2;
            this.baseThrust = 0.35;
            this.friction = 0.98;
            this.trail = [];
            // Hyper Speed state
            this.hyperSpeed = false;
            this.hyperTimer = 0;
            this.hyperCooldown = 0;
            this.lastGravWave = 0;
            this.hyperJumpCooldown = 0;
            this.droneAngle = 0;
            this.droneFireTimer = 0;
        }

        draw() {
            ctx.save();
            if (cloakTimer > 0) ctx.globalAlpha = 0.3;

            if (this.trail.length > 2) {
                ctx.beginPath();
                ctx.moveTo(this.trail[0].x, this.trail[0].y);
                for (let i = 1; i < this.trail.length; i++) {
                    ctx.lineTo(this.trail[i].x, this.trail[i].y);
                }
                ctx.strokeStyle = 'rgba(0, 229, 255, 0.3)';
                ctx.lineWidth = this.radius * 0.8;
                ctx.lineCap = 'round';
                ctx.stroke();
            }

            if (keys.rightMouse && extractionTarget) {
                ctx.beginPath();
                ctx.moveTo(this.x, this.y);
                ctx.lineTo(extractionTarget.x, extractionTarget.y);

                let beamColor = '#aaaaaa';
                if (stats.laserMode === 'EXTRACT') {
                    if (extractionTarget.resType === 'ICE') beamColor = '#00e5ff';
                    if (extractionTarget.resType === 'BIO') beamColor = '#00ff66';
                    if (extractionTarget.resType === 'MINERAL') beamColor = '#ffaa00';
                    if (extractionTarget.resType === 'SCRAP') beamColor = '#ff2a5f';
                } else if (stats.laserMode === 'PIERCE') {
                    beamColor = '#ff0033'; // Vermelho vivo
                } else {
                    beamColor = '#ffaa00'; // Cor da Rajada / Repulse
                }

                ctx.strokeStyle = beamColor;
                ctx.lineWidth = 4 + Math.random() * 4;
                ctx.shadowBlur = 15;
                ctx.shadowColor = beamColor;
                ctx.stroke();

                if (Math.random() < 0.5) {
                    let r = Math.random();
                    let px = this.x + (extractionTarget.x - this.x) * r;
                    let py = this.y + (extractionTarget.y - this.y) * r;
                    let flyDir = stats.laserMode === 'EXTRACT' ? 1 : -1;
                    particles.push(new Particle(px, py, beamColor, flyDir * (this.x - px) * 0.1, flyDir * (this.y - py) * 0.1, 3));
                }
                ctx.shadowBlur = 0;
            }

            ctx.translate(this.x, this.y);
            ctx.rotate(this.angle);
            let scale = this.radius / 25;
            ctx.scale(scale, scale);

            if (keys.w || this.hyperSpeed) {
                let fc = this.hyperSpeed ? 'rgba(180, 80, 255, 0.9)' : 'rgba(0, 229, 255, 0.7)';
                ctx.beginPath();
                ctx.moveTo(-20, -8);
                ctx.lineTo(-20 - Math.random() * (this.hyperSpeed ? 60 : 25) - 15, 0);
                ctx.lineTo(-20, 8);
                ctx.fillStyle = fc;
                ctx.fill();

                let sc = this.hyperSpeed ? 'rgba(255, 255, 255, 0.9)' : 'rgba(177, 66, 255, 0.8)';
                ctx.beginPath();
                ctx.moveTo(-24, -13); ctx.lineTo(-24 - Math.random() * (this.hyperSpeed ? 40 : 15) - 5, -13); ctx.lineTo(-24, -13);
                ctx.strokeStyle = sc; ctx.lineWidth = 4; ctx.stroke();

                ctx.beginPath();
                ctx.moveTo(-24, 13); ctx.lineTo(-24 - Math.random() * (this.hyperSpeed ? 40 : 15) - 5, 13); ctx.lineTo(-24, 13);
                ctx.stroke();
            }

            // Hyper speed shimmer — ship looks semi-transparent/ethereal
            if (this.hyperSpeed) {
                ctx.globalAlpha = 0.55 + Math.sin(Date.now() * 0.03) * 0.25;
            }

            ctx.fillStyle = '#16181d';
            ctx.beginPath();
            ctx.moveTo(35, 0);
            ctx.lineTo(15, -10);
            ctx.lineTo(-20, -12);
            ctx.lineTo(-20, 12);
            ctx.lineTo(15, 10);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = '#2a2f3a';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            ctx.fillStyle = '#101216';
            ctx.beginPath();
            ctx.moveTo(5, -9);
            ctx.lineTo(-5, -28);
            ctx.lineTo(-22, -28);
            ctx.lineTo(-15, -11);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(5, 9);
            ctx.lineTo(-5, 28);
            ctx.lineTo(-22, 28);
            ctx.lineTo(-15, 11);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = '#08090a';
            ctx.fillRect(-24, -16, 6, 6);
            ctx.fillRect(-24, 10, 6, 6);

            ctx.fillStyle = '#00e5ff';
            ctx.shadowBlur = 6;
            ctx.shadowColor = '#00e5ff';

            ctx.beginPath();
            ctx.ellipse(8, 0, 5, 2.5, 0, 0, Math.PI * 2);
            ctx.fill();

            for (let i = 0; i < 4; i++) {
                ctx.fillRect(0 - (i * 5), -6, 2, 2);
                ctx.fillRect(0 - (i * 5), 4, 2, 2);
            }

            ctx.fillStyle = '#b142ff';
            ctx.shadowColor = '#b142ff';
            ctx.beginPath(); ctx.arc(-15, -23, 1.5, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(-15, 23, 1.5, 0, Math.PI * 2); ctx.fill();

            // Desenhando Drones (Orbitais)
            if (stats.upgrades.combatDrones || stats.upgrades.repairDrones) {
                for (let i = 0; i < 3; i++) { // 3 slots of drones
                    let hasCombat = stats.upgrades.combatDrones && i < 2;
                    let hasRepair = stats.upgrades.repairDrones && i >= 2;
                    let orbitR = 40 + Math.sin(Date.now() * 0.002 + i) * 5;
                    let ang = this.droneAngle + (Math.PI * 2 / 3) * i;
                    let dx = Math.cos(ang) * orbitR;
                    let dy = Math.sin(ang) * orbitR;
                    if (hasCombat || hasRepair) {
                        ctx.save();
                        ctx.translate(dx, dy);
                        ctx.fillStyle = hasCombat ? '#ff0033' : '#00ff66';
                        ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill();
                        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke();
                        ctx.restore();
                    }
                }
            }

            ctx.shadowBlur = 0;
            ctx.globalAlpha = 1;
            ctx.restore();
        }

        update() {
            // Crescimento Baseado em XP/Level:
            this.radius = 25 + (stats.level - 1) * 1.5;

            // === HYPER SPEED (Space Bar) — one-time burst, then glide ===
            if (keys.space && !this.hyperSpeed && this.hyperCooldown <= 0) {
                this.hyperSpeed = true;
                this.hyperTimer = 180; // ~3 seconds at 60fps
                // Give a strong one-time velocity burst in current facing direction
                let burstSpeed = 28;
                this.vx = Math.cos(this.angle) * burstSpeed;
                this.vy = Math.sin(this.angle) * burstSpeed;
                AudioSys.playTone(220, 'sawtooth', 0.15, 0.05, 600);
                triggerShake(8);
            }
            if (this.hyperSpeed) {
                this.hyperTimer--;
                if (this.hyperTimer <= 0) {
                    this.hyperSpeed = false;
                    this.hyperCooldown = 300;
                    AudioSys.playTone(110, 'sine', 0.1, 0.05, 400);
                }
                // Hyper trail
                if (Math.random() < 0.85) {
                    let px = this.x - Math.cos(this.angle) * this.radius;
                    let py = this.y - Math.sin(this.angle) * this.radius;
                    particles.push(new Particle(px, py, '#b142ff',
                        -this.vx * 0.3 + (Math.random() - 0.5) * 3,
                        -this.vy * 0.3 + (Math.random() - 0.5) * 3, 14));
                }
            }
            if (this.hyperCooldown > 0) this.hyperCooldown--;

            let currentThrust = this.baseThrust * stats.speed;

            // === HYPERDRIVE JUMP (Shift) ===
            if (keys.shift && stats.upgrades.hyperdrive && this.hyperJumpCooldown <= 0) {
                this.hyperJumpCooldown = 800; // grande cooldown
                createExplosion(this.x, this.y, '#b142ff', 60);
                triggerShake(20);
                let jumpDist = 6000;
                let mouseWXY = getMouseWorld();
                let jumpAngle = Math.atan2(mouseWXY.y - this.y, mouseWXY.x - this.x);
                this.x += Math.cos(jumpAngle) * jumpDist;
                this.y += Math.sin(jumpAngle) * jumpDist;
                camera.x = this.x; camera.y = this.y;
                createExplosion(this.x, this.y, '#ffffff', 80);
                AudioSys.playTone(100, 'square', 0.2, 0.5, 900);
            }
            if (this.hyperJumpCooldown > 0) this.hyperJumpCooldown--;

            // Drones orbit angle
            this.droneAngle += 0.04;
            if (stats.upgrades.repairDrones) {
                stats.hull = Math.min(stats.maxHull, stats.hull + 0.05); // Reparo ativo contínuo
            }
            if (stats.upgrades.combatDrones) {
                this.droneFireTimer++;
                if (this.droneFireTimer > 40) {
                    this.droneFireTimer = 0;
                    // Shoot at closest pirate!
                    let closestPirate = null; let minDist = 700;
                    pirates.forEach(p => { let d = Math.hypot(p.x - this.x, p.y - this.y); if (d < minDist) { minDist = d; closestPirate = p; } });
                    if (closestPirate) {
                        let ang = Math.atan2(closestPirate.y - this.y, closestPirate.x - this.x);
                        projectiles.push(new Projectile(this.x, this.y, Math.cos(ang) * 22, Math.sin(ang) * 22, '#ff0033', false, 8 * stats.dmgMult, false));
                        AudioSys.playTone(600, 'square', 0.02, 0.05, 1200);
                    }
                }
            }

            let mouseWorldX = (mouseScreen.x - width / 2) / zoom + camera.x;
            let mouseWorldY = (mouseScreen.y - height / 2) / zoom + camera.y;

            let desiredAngle = Math.atan2(mouseWorldY - this.y, mouseWorldX - this.x);
            let angleDiff = desiredAngle - this.angle;
            while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
            while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
            this.angle += angleDiff * 0.15;

            // Normal movement only when NOT in hyper speed
            if (!this.hyperSpeed) {
                if (keys.w) {
                    this.vx += Math.cos(this.angle) * currentThrust;
                    this.vy += Math.sin(this.angle) * currentThrust;
                    AudioSys.sfx.engine();
                    if (Math.random() < 0.4) {
                        let px = this.x - Math.cos(this.angle) * this.radius;
                        let py = this.y - Math.sin(this.angle) * this.radius;
                        particles.push(new Particle(px, py, '#00e5ff',
                            this.vx - Math.cos(this.angle) * 4 + (Math.random() - 0.5) * 2,
                            this.vy - Math.sin(this.angle) * 4 + (Math.random() - 0.5) * 2, 8));
                    }
                }
                if (keys.s) {
                    this.vx -= Math.cos(this.angle) * currentThrust * 0.4;
                    this.vy -= Math.sin(this.angle) * currentThrust * 0.4;
                }
                if (keys.a) {
                    this.vx += Math.cos(this.angle - Math.PI / 2) * currentThrust * 0.5;
                    this.vy += Math.sin(this.angle - Math.PI / 2) * currentThrust * 0.5;
                }
                if (keys.d) {
                    this.vx += Math.cos(this.angle + Math.PI / 2) * currentThrust * 0.5;
                    this.vy += Math.sin(this.angle + Math.PI / 2) * currentThrust * 0.5;
                }
            }

            let friction = this.hyperSpeed ? 0.998 : this.friction;
            this.vx *= friction;
            this.vy *= friction;
            this.x += this.vx;
            this.y += this.vy;

            this.trail.unshift({ x: this.x, y: this.y });
            if (this.trail.length > 10) this.trail.pop();

            camera.x += (this.x - camera.x) * 0.08;
            camera.y += (this.y - camera.y) * 0.08;

            this.draw();
            if (cloakTimer <= 0) this.shoot();
            this.useEKey();
            if (cloakTimer <= 0) this.extract();
        }

        shoot() {
            let now = Date.now();
            if (keys.mouse && now - lastShotTime > stats.fireRate) {
                lastShotTime = now;
                AudioSys.sfx.shoot();

                let baseDmg = 5 * stats.dmgMult;
                let spread = 0.15;
                let startAngle = this.angle - (spread * (stats.multishot - 1) / 2);

                for (let i = 0; i < stats.multishot; i++) {
                    let a = startAngle + (i * spread);
                    let px = this.x + Math.cos(this.angle) * this.radius;
                    let py = this.y + Math.sin(this.angle) * this.radius;
                    projectiles.push(new Projectile(px, py, Math.cos(a) * 25 + this.vx, Math.sin(a) * 25 + this.vy, baseDmg, false));
                }

                let recoilForce = 1.0 * stats.recoil;
                this.vx -= Math.cos(this.angle) * recoilForce;
                this.vy -= Math.sin(this.angle) * recoilForce;
                triggerShake(2);
            }
        }

        useEKey() {
            if (!keys.e) { this._ePressHandled = false; return; }
            if (this._ePressHandled) return;
            this._ePressHandled = true;

            // If already in a colony — LAUNCH OFF
            if (gameState === 'COLONY') {
                leaveColony();
                return;
            }

            // Check if near a planet surface — COLONIZE
            let nearPlanet = null;
            let nearDist = Infinity;
            planets.forEach(p => {
                let d = Math.hypot(this.x - p.x, this.y - p.y);
                if (d < p.radius + 150 && d < nearDist) {
                    nearDist = d;
                    nearPlanet = p;
                }
            });

            if (nearPlanet) {
                let cost = { ice: 3, leaves: 2, fruits: 2, minerals: 5 };
                if (stats.inv.ice >= cost.ice && stats.inv.leaves >= cost.leaves &&
                    stats.inv.fruits >= cost.fruits && stats.inv.minerals >= cost.minerals) {
                    stats.inv.ice -= cost.ice;
                    stats.inv.leaves -= cost.leaves;
                    stats.inv.fruits -= cost.fruits;
                    stats.inv.minerals -= cost.minerals;
                    nearPlanet.colonized = true;
                    colonizedPlanet = nearPlanet;
                    // Snap player to planet surface
                    let ang = Math.atan2(this.y - nearPlanet.y, this.x - nearPlanet.x);
                    this.x = nearPlanet.x + Math.cos(ang) * (nearPlanet.radius + this.radius + 5);
                    this.y = nearPlanet.y + Math.sin(ang) * (nearPlanet.radius + this.radius + 5);
                    this.vx = 0; this.vy = 0;
                    gameState = 'COLONY';
                    if (callbacks.onEnterColony) callbacks.onEnterColony({ planet: nearPlanet });
                    AudioSys.playTone(400, 'sine', 0.2, 0.05, 1000);
                    syncHUD();
                } else {
                    floatingTexts.push(new FloatingText(this.x, this.y - 60,
                        'Faltam recursos! (3🧊 2🍃 2🍎 5⛏)', '#ff2a5f', 16));
                    AudioSys.playTone(150, 'square', 0.1, 0.05, 200);
                }
            } else {
                // No planet nearby — fire gravity wave
                let now = Date.now();
                if (now - this.lastGravWave > 2000) {
                    this.lastGravWave = now;
                    gravityWaves.push(new GravityWave(this.x, this.y));
                    AudioSys.playTone(60, 'sine', 0.3, 0.1, 1200);
                    triggerShake(10);
                }
            }
        }

        extract() {
            if (!keys.rightMouse) {
                extractionTarget = null;
                return;
            }

            let mouseWorldX = (mouseScreen.x - width / 2) / zoom + camera.x;
            let mouseWorldY = (mouseScreen.y - height / 2) / zoom + camera.y;

            let closest = null;
            let closestDist = Infinity;

            const targets = [...planets, ...debris];
            targets.forEach(p => {
                let dToMouse = Math.hypot(p.x - mouseWorldX, p.y - mouseWorldY);
                let dToShip = Math.hypot(p.x - this.x, p.y - this.y);
                // Extraction range scales with planet size — giant planets reachable from surface
                let extractRange = Math.max(800, p.radius * 1.8);

                if (dToMouse < p.radius + 80 && dToShip < extractRange) {
                    if (dToShip < closestDist) {
                        closestDist = dToShip;
                        closest = p;
                    }
                }
            });

            extractionTarget = closest;

            if (extractionTarget) {
                AudioSys.playNoise(0.05, 0.01);

                if (stats.laserMode === 'EXTRACT') {
                    let oldRad = Math.floor(extractionTarget.radius);
                    extractionTarget.radius -= 0.5; // Rapidez de extração
                    let newRad = Math.floor(extractionTarget.radius);

                    if (oldRad !== newRad) {
                        let exType = ''; let exColor = '';
                        if (extractionTarget.resType === 'ICE') { exType = 'GELO'; exColor = '#00e5ff'; }
                        else if (extractionTarget.resType === 'BIO') {
                            let isLeaf = Math.random() > 0.4;
                            exType = isLeaf ? 'FOLHAS' : 'FRUTAS';
                            exColor = '#00ff66';
                        }
                        else if (extractionTarget.resType === 'MINERAL') { exType = 'MINÉRIO'; exColor = '#ffaa00'; }
                        else if (extractionTarget.resType === 'SCRAP') { exType = 'SUCATA'; exColor = '#ff2a5f'; }

                        if (exType) {
                            let randAngle = Math.atan2(this.y - extractionTarget.y, this.x - extractionTarget.x) + (Math.random() - 0.5) * 0.5;
                            let spawnX = extractionTarget.x + Math.cos(randAngle) * extractionTarget.radius;
                            let spawnY = extractionTarget.y + Math.sin(randAngle) * extractionTarget.radius;
                            extractorParticles.push(new ExtractorParticle(spawnX, spawnY, exType, exColor, 1));
                        }
                    }

                    if (extractionTarget.radius < 5) {
                        createExplosion(extractionTarget.x, extractionTarget.y, extractionTarget.baseColor || '#ff2a5f', 20);
                        if (extractionTarget.mass) planets.splice(planets.indexOf(extractionTarget), 1);
                        else debris.splice(debris.indexOf(extractionTarget), 1);
                        extractionTarget = null;
                    } else if (extractionTarget.mass) {
                        extractionTarget.mass = extractionTarget.radius * extractionTarget.radius;
                    }
                } else if (stats.laserMode === 'REPULSE') {
                    let anglePush = Math.atan2(extractionTarget.y - this.y, extractionTarget.x - this.x);
                    let force = 2.0;
                    if (!extractionTarget.mass) force = 4.0; // debris é mais leve
                    extractionTarget.vx += Math.cos(anglePush) * force;
                    extractionTarget.vy += Math.sin(anglePush) * force;
                } else if (stats.laserMode === 'PIERCE') {
                    // Continuous damage to pirates intersecting the beam
                    let p1 = { x: this.x, y: this.y }, p2 = { x: extractionTarget.x, y: extractionTarget.y };
                    pirates.forEach(pir => {
                        let dot = (((pir.x - p1.x) * (p2.x - p1.x)) + ((pir.y - p1.y) * (p2.y - p1.y))) / (Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
                        let closestX = p1.x + dot * (p2.x - p1.x);
                        let closestY = p1.y + dot * (p2.y - p1.y);
                        if (dot >= 0 && dot <= 1 && Math.hypot(closestX - pir.x, closestY - pir.y) < pir.radius + 15) {
                            pir.hp -= 2.5 * stats.dmgMult; // ignores armor partly
                            if (Math.random() < 0.2) createExplosion(pir.x, pir.y, '#ff0033', 5);
                            if (pir.hp <= 0) destroyPirate(pir);
                        }
                    });
                }
            }
        }
    }

    class GravityWave {
        constructor(x, y) {
            this.x = x; this.y = y;
            this.radius = 0;
            this.maxRadius = 900;
            this.speed = 18;
            this.life = 1.0;
            this.damage = 30;
            this.hitTargets = new Set(); // avoid hitting same target twice
        }
        draw() {
            if (this.life <= 0) return;
            ctx.save();
            ctx.globalAlpha = this.life * 0.7;
            ctx.globalCompositeOperation = 'lighter';

            // Outer ring
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
            ctx.strokeStyle = `hsl(${270 + this.radius * 0.1}, 100%, 70%)`;
            ctx.lineWidth = 12 * this.life;
            ctx.shadowBlur = 30;
            ctx.shadowColor = '#b142ff';
            ctx.stroke();

            // Inner ring
            if (this.radius > 60) {
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.radius * 0.7, 0, Math.PI * 2);
                ctx.strokeStyle = `rgba(100, 200, 255, ${this.life * 0.4})`;
                ctx.lineWidth = 5 * this.life;
                ctx.shadowBlur = 15;
                ctx.shadowColor = '#00e5ff';
                ctx.stroke();
            }

            ctx.restore();
        }
        update() {
            this.radius += this.speed;
            this.life = 1.0 - (this.radius / this.maxRadius);

            // Apply damage & push to enemies within the ring band
            let band = this.speed * 2;
            pirates.forEach(pir => {
                let d = Math.hypot(pir.x - this.x, pir.y - this.y);
                if (d >= this.radius - band && d <= this.radius + band && !this.hitTargets.has(pir)) {
                    this.hitTargets.add(pir);
                    pir.hp -= this.damage;
                    // Knock back
                    let ang = Math.atan2(pir.y - this.y, pir.x - this.x);
                    pir.vx += Math.cos(ang) * 8;
                    pir.vy += Math.sin(ang) * 8;
                    AudioSys.sfx.hit();
                    createExplosion(pir.x, pir.y, '#b142ff', 12);
                    if (pir.hp <= 0) destroyPirate(pir);
                }
            });

            this.draw();
        }
    }

    class Projectile {
        constructor(x, y, vx, vy, damage, isEnemy = false) {
            this.x = x; this.y = y; this.vx = vx; this.vy = vy;
            this.damage = damage; this.life = 60; this.radius = 4;
            this.isEnemy = isEnemy;
            this.color = isEnemy ? '#ff2a5f' : '#00e5ff';
            if (!isEnemy && stats.upgrades.explosive) {
                this.radius = 6;
                this.color = '#ffaa00';
            }
        }
        draw() {
            ctx.save();
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
            ctx.fillStyle = this.color;
            ctx.fill();

            ctx.globalCompositeOperation = 'lighter';
            ctx.beginPath();
            ctx.moveTo(this.x, this.y);
            ctx.lineTo(this.x - this.vx * 1.5, this.y - this.vy * 1.5);
            ctx.strokeStyle = this.color;
            ctx.lineWidth = this.radius * 2;
            ctx.stroke();

            ctx.restore();
        }
        update() {
            // Homing Upgrade Logic
            if (!this.isEnemy && stats.upgrades.homing) {
                let closestDist = 1200;
                let target = null;
                pirates.forEach(pir => {
                    let d = Math.hypot(this.x - pir.x, this.y - pir.y);
                    if (d < closestDist) {
                        closestDist = d;
                        target = pir;
                    }
                });
                if (target) {
                    let currentSpeed = Math.hypot(this.vx, this.vy);
                    let angleToTarget = Math.atan2(target.y - this.y, target.x - this.x);
                    let currentAngle = Math.atan2(this.vy, this.vx);

                    let angleDiff = angleToTarget - currentAngle;
                    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
                    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

                    // Steer towards target
                    currentAngle += angleDiff * 0.1;

                    this.vx = Math.cos(currentAngle) * currentSpeed;
                    this.vy = Math.sin(currentAngle) * currentSpeed;
                }
            }

            this.x += this.vx; this.y += this.vy; this.life--;
            this.draw();
        }
    }

    // O Pavoroso e Robusto Pirata Nível Elite
    class PirateShip {
        constructor(x, y) {
            this.x = x; this.y = y;
            this.vx = 0; this.vy = 0;

            // Atribui nível e stats ao Pirata (Scale with Player Level)
            this.level = Math.floor(Math.random() * stats.level) + 1;
            this.radius = 20 + (this.level * 2);
            this.angle = Math.random() * Math.PI * 2;
            this.thrust = 0.2 + (this.level * 0.05);
            this.friction = 0.96;
            this.hp = 30 + (this.level * 20);
            this.fireRate = 1200 - Math.min(800, this.level * 100);
            this.lastShot = Date.now();
            this.state = 'WANDER';
            this.targetX = this.x + (Math.random() - 0.5) * 1500;
            this.targetY = this.y + (Math.random() - 0.5) * 1500;
            this.mass = this.radius * this.radius;
        }
        draw() {
            ctx.save();
            ctx.translate(this.x, this.y);
            ctx.rotate(this.angle);
            let scale = this.radius / 25;
            ctx.scale(scale, scale);

            // Engine flames (red/hostile)
            if (this.state === 'ATTACK' || Math.random() < 0.7) {
                ctx.beginPath();
                ctx.moveTo(-20, -8);
                ctx.lineTo(-20 - Math.random() * 25 - 10, 0);
                ctx.lineTo(-20, 8);
                ctx.fillStyle = 'rgba(255, 42, 95, 0.85)';
                ctx.fill();
                ctx.beginPath();
                ctx.moveTo(-24, -13); ctx.lineTo(-24 - Math.random() * 12 - 4, -13); ctx.lineTo(-24, -13);
                ctx.strokeStyle = 'rgba(255, 140, 0, 0.9)'; ctx.lineWidth = 4; ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(-24, 13); ctx.lineTo(-24 - Math.random() * 12 - 4, 13); ctx.lineTo(-24, 13);
                ctx.stroke();
            }

            // Same hull geometry as player but in dark red
            ctx.fillStyle = '#1a0808';
            ctx.beginPath();
            ctx.moveTo(35, 0);
            ctx.lineTo(15, -10);
            ctx.lineTo(-20, -12);
            ctx.lineTo(-20, 12);
            ctx.lineTo(15, 10);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = '#5a0f0f';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            // Wings (same shape as player, red tint)
            ctx.fillStyle = '#0d0404';
            ctx.beginPath();
            ctx.moveTo(5, -9); ctx.lineTo(-5, -28); ctx.lineTo(-22, -28); ctx.lineTo(-15, -11); ctx.closePath();
            ctx.fill(); ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(5, 9); ctx.lineTo(-5, 28); ctx.lineTo(-22, 28); ctx.lineTo(-15, 11); ctx.closePath();
            ctx.fill(); ctx.stroke();

            // Engine pods
            ctx.fillStyle = '#080303';
            ctx.fillRect(-24, -16, 6, 6);
            ctx.fillRect(-24, 10, 6, 6);

            // Cockpit glow (red instead of cyan)
            ctx.fillStyle = '#ff2a5f';
            ctx.shadowBlur = 8;
            ctx.shadowColor = '#ff2a5f';
            ctx.beginPath(); ctx.ellipse(8, 0, 5, 2.5, 0, 0, Math.PI * 2); ctx.fill();
            for (let i = 0; i < 4; i++) {
                ctx.fillRect(0 - (i * 5), -6, 2, 2);
                ctx.fillRect(0 - (i * 5), 4, 2, 2);
            }
            ctx.fillStyle = '#ffaa00';
            ctx.shadowColor = '#ffaa00';
            ctx.beginPath(); ctx.arc(-15, -23, 1.5, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(-15, 23, 1.5, 0, Math.PI * 2); ctx.fill();

            ctx.shadowBlur = 0;
            ctx.restore();
        }
        update() {
            let targetX = player.x;
            let targetY = player.y;
            if (this.isEnemy) {
                // Ignore player if cloaked
                if (cloakTimer > 0) return;
                let closestFlare = null; let fDist = 9999;
                flares.forEach(f => { let d = Math.hypot(f.x - this.x, f.y - this.y); if (d < fDist) { fDist = d; closestFlare = f; } });
                if (closestFlare) { targetX = closestFlare.x; targetY = closestFlare.y; }
            } else {
                this.state = 'WANDER';
            }

            if (this.state === 'WANDER') {
                this.x += this.vx * 0.5;
                this.y += this.vy * 0.5;
                let dist = Math.hypot(player.x - this.x, player.y - this.y);
                if (dist < 1200 && cloakTimer <= 0) this.state = 'ATTACK';
                let distToTarget = Math.hypot(this.targetX - this.x, this.targetY - this.y);
                if (distToTarget < 100) {
                    this.targetX = this.x + (Math.random() - 0.5) * 2000;
                    this.targetY = this.y + (Math.random() - 0.5) * 2000;
                }
            }

            let desiredAngle = Math.atan2(targetY - this.y, targetX - this.x);
            let angleDiff = desiredAngle - this.angle;
            while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
            while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

            this.angle += angleDiff * 0.05;

            this.vx += Math.cos(this.angle) * this.thrust;
            this.vy += Math.sin(this.angle) * this.thrust;

            if (this.state === 'ATTACK' && Math.hypot(player.x - this.x, player.y - this.y) < (400 + this.level * 50)) {
                this.vx -= Math.cos(this.angle) * this.thrust * 1.5;
                this.vy -= Math.sin(this.angle) * this.thrust * 1.5;
            }

            this.vx *= this.friction;
            this.vy *= this.friction;
            this.x += this.vx;
            this.y += this.vy;

            if (this.state === 'ATTACK' && Math.hypot(player.x - this.x, player.y - this.y) < 900 && Date.now() - this.lastShot > this.fireRate) {
                this.lastShot = Date.now();
                AudioSys.sfx.enemyShoot();

                // Nível pirata determina balística
                let projDmg = 8 + (this.level * 2);
                let px = this.x + Math.cos(this.angle) * this.radius;
                let py = this.y + Math.sin(this.angle) * this.radius;

                projectiles.push(new Projectile(px, py, Math.cos(this.angle) * 15 + this.vx, Math.sin(this.angle) * 15 + this.vy, projDmg, true));

                // Múltiplos tiros se lvl > 4
                if (this.level > 4) {
                    projectiles.push(new Projectile(px, py, Math.cos(this.angle - 0.1) * 15 + this.vx, Math.sin(this.angle - 0.1) * 15 + this.vy, projDmg, true));
                    projectiles.push(new Projectile(px, py, Math.cos(this.angle + 0.1) * 15 + this.vx, Math.sin(this.angle + 0.1) * 15 + this.vy, projDmg, true));
                }
            }

            this.draw();
        }
    }

    class Debris {
        constructor(x, y, radius) {
            this.x = x; this.y = y; this.radius = radius;
            this.vx = (Math.random() - 0.5) * 4; this.vy = (Math.random() - 0.5) * 4;
            this.resType = 'SCRAP';
            this.rot = Math.random() * Math.PI * 2;
            this.vRot = (Math.random() - 0.5) * 0.1;
        }
        draw() {
            ctx.save();
            ctx.translate(this.x, this.y);
            ctx.rotate(this.rot);

            // Corpo angular para parecer destroços
            ctx.beginPath();
            ctx.moveTo(-this.radius, -this.radius * 0.5);
            ctx.lineTo(this.radius * 0.8, -this.radius);
            ctx.lineTo(this.radius, this.radius * 0.8);
            ctx.lineTo(-this.radius * 0.3, this.radius);
            ctx.closePath();

            ctx.fillStyle = '#222';
            ctx.fill();
            ctx.strokeStyle = '#ff2a5f';
            ctx.lineWidth = 1;
            ctx.stroke();

            ctx.restore();
        }
        update() {
            this.x += this.vx; this.y += this.vy;
            this.vx *= 0.98; this.vy *= 0.98;
            this.rot += this.vRot;
            this.draw();
        }
    }

    class Planet {
        constructor(x, y, radius) {
            this.x = x; this.y = y; this.radius = radius;
            this.vx = (Math.random() - 0.5) * 1; this.vy = (Math.random() - 0.5) * 1;

            let rng = Math.random();
            if (rng < 0.33) {
                this.resType = 'ICE';
                let hue = 190 + Math.random() * 40;
                this.baseColor = `hsl(${hue}, 60%, 50%)`;
            } else if (rng < 0.66) {
                this.resType = 'BIO';
                let hue = 90 + Math.random() * 40;
                this.baseColor = `hsl(${hue}, 50%, 40%)`;
            } else {
                this.resType = 'MINERAL';
                let hue = 20 + Math.random() * 30;
                let sat = Math.random() * 30;
                this.baseColor = `hsl(${hue}, ${sat}%, 40%)`;
            }

            this.mass = radius * radius;
        }
        draw() {
            ctx.save();
            ctx.translate(this.x, this.y);

            ctx.beginPath();
            ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
            ctx.fillStyle = this.baseColor;
            ctx.fill();

            ctx.beginPath();
            ctx.arc(-this.radius * 0.2, -this.radius * 0.2, this.radius, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
            ctx.fill();

            // Colonized marker: pulsing green ring
            if (this.colonized) {
                let pulse = Math.sin(Date.now() * 0.004) * 0.3 + 0.7;
                ctx.beginPath();
                ctx.arc(0, 0, this.radius + 18, 0, Math.PI * 2);
                ctx.strokeStyle = `rgba(0, 255, 102, ${pulse})`;
                ctx.lineWidth = 6;
                ctx.shadowBlur = 20;
                ctx.shadowColor = '#00ff66';
                ctx.stroke();
                ctx.shadowBlur = 0;
                // Colony icon
                ctx.font = `${Math.min(40, this.radius * 0.12)}px Arial`;
                ctx.textAlign = 'center';
                ctx.fillText('🏠', 0, -this.radius - 30);
            }

            if (this.resType === 'MINERAL') {
                ctx.beginPath();
                ctx.arc(this.radius * 0.2, this.radius * 0.2, this.radius * 0.3, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(255, 150, 0, 0.3)';
                ctx.fill();
            }

            // Draw colony buildings on surface
            if (this.buildings && this.buildings.length > 0) {
                this.buildings.forEach(b => {
                    let bt = BUILDING_TYPES[b.type];
                    if (!bt) return;
                    ctx.save();
                    ctx.translate(Math.cos(b.angle) * (this.radius + bt.h * 0.5), Math.sin(b.angle) * (this.radius + bt.h * 0.5));
                    ctx.rotate(b.angle + Math.PI / 2);

                    // Ground plate
                    ctx.fillStyle = 'rgba(0,0,0,0.8)';
                    ctx.fillRect(-11, 0, 22, 6);

                    if (b.type === 'FARM') {
                        ctx.fillStyle = bt.color;
                        ctx.fillRect(-7, -bt.h * 0.55, 14, bt.h * 0.55);
                        ctx.beginPath(); ctx.arc(0, -bt.h * 0.55, 7, Math.PI, 0); ctx.fill();
                        ctx.fillStyle = '#006622'; ctx.fillRect(-5, -4, 3, 8); ctx.fillRect(2, -4, 3, 8);
                    } else if (b.type === 'PURIFIER') {
                        ctx.fillStyle = bt.color;
                        ctx.fillRect(-6, -bt.h * 0.7, 12, bt.h * 0.7);
                        ctx.beginPath(); ctx.arc(0, -bt.h * 0.7, 6, Math.PI, 0); ctx.fill();
                        ctx.fillStyle = '#1144aa'; ctx.fillRect(-2, -bt.h * 0.25, 4, bt.h * 0.25);
                    } else if (b.type === 'GENERATOR') {
                        ctx.fillStyle = bt.color;
                        ctx.fillRect(-9, -bt.h * 0.65, 18, bt.h * 0.65);
                        ctx.fillStyle = '#fff'; ctx.font = '14px Arial'; ctx.textAlign = 'center';
                        ctx.fillText('⚡', 0, -bt.h * 0.2);
                    } else if (b.type === 'TURRET') {
                        ctx.fillStyle = '#333'; ctx.fillRect(-8, -bt.h * 0.5, 16, bt.h * 0.5);
                        ctx.fillStyle = b.firing ? '#ff8888' : bt.color;
                        if (b.firing) { ctx.shadowBlur = 15; ctx.shadowColor = bt.color; b.firing = false; }
                        ctx.fillRect(-3, -bt.h * 0.5 - 18, 6, 18);
                        ctx.shadowBlur = 0;
                    }
                    ctx.restore();
                });
            }

            ctx.restore();
        }
        update() {
            this.x += this.vx; this.y += this.vy;
            this.draw();
        }
    }

    // (Omitindo Sun, BlackHole, Wormhole, Worm etc no código inteiro seria muito chato/longo, mas tem que estar)
    // Para caber em tamanho compacto, escreverei Sun normal.
    class Sun {
        constructor(x, y, radius) {
            this.x = x; this.y = y; this.radius = radius;
            this.mass = radius * radius * 5;
            let hue = Math.random() > 0.5 ? 30 : 200;
            this.color1 = `hsla(${hue}, 100%, 80%, 1)`;
            this.color2 = `hsla(${hue}, 100%, 50%, 0.8)`;
            this.color3 = `hsla(${hue}, 100%, 30%, 0)`;
        }
        draw() {
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            let pulse = Math.sin(Date.now() * 0.003) * 0.05 + 1;

            let grad = ctx.createRadialGradient(this.x, this.y, this.radius * 0.2, this.x, this.y, this.radius * 2.5 * pulse);
            grad.addColorStop(0, this.color1);
            grad.addColorStop(0.2, this.color2);
            grad.addColorStop(1, this.color3);

            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius * 2.5 * pulse, 0, Math.PI * 2);
            ctx.fillStyle = grad;
            ctx.fill();

            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius * 0.8, 0, Math.PI * 2);
            ctx.fillStyle = '#fff';
            ctx.fill();
            ctx.restore();
        }
        update() { this.draw(); }
    }

    class Particle {
        constructor(x, y, color, vx = null, vy = null, size = 4) {
            this.x = x; this.y = y; this.color = color;
            this.radius = Math.random() * size + 1;
            let angle = Math.random() * Math.PI * 2;
            let speed = Math.random() * 12 + 2;
            this.vx = vx !== null ? vx : Math.cos(angle) * speed;
            this.vy = vy !== null ? vy : Math.sin(angle) * speed;
            this.life = 1.0;
            this.decay = Math.random() * 0.02 + 0.02;
            this.friction = 0.92;
        }
        draw() {
            ctx.save(); ctx.globalAlpha = this.life;
            ctx.globalCompositeOperation = 'lighter';
            ctx.beginPath(); ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
            ctx.fillStyle = this.color;
            ctx.fill(); ctx.restore();
        }
        update() {
            this.vx *= this.friction; this.vy *= this.friction;
            this.x += this.vx; this.y += this.vy;
            this.life -= this.decay; this.draw();
        }
    }

    class FloatingText {
        constructor(x, y, text, color, size = 24) {
            this.x = x; this.y = y; this.text = text; this.color = color;
            this.life = 1.0; this.vy = -1.5; this.size = size;
        }
        draw() {
            ctx.save(); ctx.globalAlpha = this.life;
            ctx.font = `900 ${this.size}px Orbitron`; ctx.fillStyle = this.color;
            ctx.textAlign = 'center'; ctx.fillText(this.text, this.x, this.y);
            ctx.restore();
        }
        update() { this.y += this.vy; this.life -= 0.015; this.draw(); }
    }

    function initStars() {
        backgroundStars = [];
        for (let i = 0; i < 400; i++) {
            backgroundStars.push({
                x: (Math.random() - 0.5) * 30000,
                y: (Math.random() - 0.5) * 30000,
                size: Math.random() * 2 + 0.5,
                parallax: Math.random() * 0.08 + 0.02,
                color: Math.random() > 0.8 ? '#00e5ff' : '#aaaaaa'
            });
        }
    }

    player = new Player();

    function spawnWorldEntities() {
        planets = []; suns = []; worms = []; blackHoles = []; wormholes = []; pirates = []; debris = [];
        initStars();

        for (let i = 0; i < 80; i++) {
            let a = Math.random() * Math.PI * 2;
            let d = Math.random() * 20000 + 1500;
            // GIGANTIC planets — some are cave-scale colossi
            let isGiant = Math.random() < 0.45;
            let r = isGiant ? (Math.random() * 500 + 350) : (Math.random() * 180 + 80);
            planets.push(new Planet(Math.cos(a) * d, Math.sin(a) * d, r));
        }

        for (let i = 0; i < 30; i++) {
            let a = Math.random() * Math.PI * 2;
            let d = Math.random() * 15000 + 2000;
            suns.push(new Sun(Math.cos(a) * d, Math.sin(a) * d, Math.random() * 60 + 50));
        }

        for (let i = 0; i < 20; i++) {
            let squadSize = Math.floor(Math.random() * 4) + 1;
            let cx = (Math.random() - 0.5) * 20000;
            let cy = (Math.random() - 0.5) * 20000;
            for (let j = 0; j < squadSize; j++) pirates.push(new PirateShip(cx + (Math.random() - 0.5) * 400, cy + (Math.random() - 0.5) * 400));
        }
    }

    function createExplosion(x, y, color, amount) {
        AudioSys.sfx.explosion();
        for (let i = 0; i < amount; i++) particles.push(new Particle(x, y, color, null, null, amount > 50 ? 6 : 4));
        triggerShake(Math.min(amount * 0.2, 20));
    }

    const applyAreaDamage = (cx, cy, radius, dmg) => {
        // Area damage against pirates and planets from EXPLOSIVE feature
        createExplosion(cx, cy, '#ffaa00', 30);
        pirates.forEach(pir => {
            if (Math.hypot(pir.x - cx, pir.y - cy) < radius + pir.radius) {
                pir.hp -= dmg;
                AudioSys.sfx.hit();
                if (pir.hp <= 0) destroyPirate(pir);
            }
        });
        planets.forEach(p => {
            if (Math.hypot(p.x - cx, p.y - cy) < radius + p.radius) {
                p.radius -= dmg * 0.2;
                p.mass = p.radius * p.radius;
                if (p.radius < 5) planets.splice(planets.indexOf(p), 1);
            }
        });
    };

    function destroyPirate(pir) {
        createExplosion(pir.x, pir.y, '#ff2a5f', 50);
        let xpGained = 15 + pir.level * 10;
        score += xpGained; gainXP(xpGained);
        floatingTexts.push(new FloatingText(pir.x, pir.y, `+${xpGained}XP`, '#ffaa00'));
        pirates.splice(pirates.indexOf(pir), 1);

        // Spawn Debris where pirate died
        for (let k = 0; k < (2 + Math.random() * 3); k++) {
            debris.push(new Debris(pir.x + (Math.random() - 0.5) * 20, pir.y + (Math.random() - 0.5) * 20, 8 + Math.random() * 8));
        }
    }

    function gainXP(amt) {
        stats.xp += amt;
        while (stats.xp >= stats.xpNext) {
            stats.xp -= stats.xpNext;
            stats.level++;
            stats.xpNext = Math.floor(stats.xpNext * 1.5);
        }
        syncHUD();
    }

    function die(reason) {
        if (gameState === 'GAMEOVER') return;
        gameState = 'GAMEOVER';
        createExplosion(player.x, player.y, '#b142ff', 150);
        triggerShake(50);
        AudioSys.playNoise(2, 1, true);

        setTimeout(() => { callbacks.onGameOver(reason, Math.floor(score)); }, 2000);
    }

    function handleSurvivalTick() {
        // While in colony: no drain, slow hull regen
        if (gameState === 'COLONY') {
            stats.hull = Math.min(stats.maxHull, stats.hull + 0.04);
            stats.food = Math.min(stats.maxFood, stats.food + 0.008);
            stats.water = Math.min(stats.maxWater, stats.water + 0.01);
            if (Math.random() < 0.1) syncHUD();
            return;
        }

        stats.food -= 0.015;
        stats.water -= 0.02;

        if (stats.food <= 0) { stats.food = 0; stats.hull -= 0.05; }
        if (stats.water <= 0) { stats.water = 0; stats.hull -= 0.05; }

        stats.food = Math.min(stats.food, stats.maxFood);
        stats.water = Math.min(stats.water, stats.maxWater);
        stats.hull = Math.min(stats.hull, stats.maxHull);

        if (stats.hull <= 0) die("Privação de Recursos ou Danos Críticos.");

        if (Date.now() - lastCombatTime > 5000 && stats.shield < stats.maxShield) {
            stats.shield = Math.min(stats.maxShield, stats.shield + 0.3);
        }

        if (Math.random() < 0.1) syncHUD();
    }

    function drawParallaxStars() {
        let biome = getCurrentBiome(player.x, player.y);
        ctx.fillStyle = biome.bg;
        ctx.fillRect(-width / 2, -height / 2, width, height);

        ctx.save();
        ctx.fillStyle = '#fff';
        backgroundStars.forEach(s => {
            let px = s.x - camera.x * s.parallax;
            let py = s.y - camera.y * s.parallax;
            if (px > -width / 2 - 10 && px < width / 2 + 10 && py > -height / 2 - 10 && py < height / 2 + 10) {
                ctx.fillStyle = s.color;
                ctx.fillRect(px, py, s.size, s.size);
            }
        });
        ctx.restore();
    }

    function leaveColony() {
        if (gameState !== 'COLONY' || !colonizedPlanet) return;
        // Launch player away from planet surface
        let ang = Math.atan2(player.y - colonizedPlanet.y, player.x - colonizedPlanet.x);
        player.vx = Math.cos(ang) * 8;
        player.vy = Math.sin(ang) * 8;
        colonizedPlanet = null;
        gameState = 'PLAYING';
        if (callbacks.onLeaveColony) callbacks.onLeaveColony();
        AudioSys.playTone(300, 'sawtooth', 0.15, 0.05, 500);
        triggerShake(6);
    }

    let animationId;

    function gameLoop() {
        if (gameState !== 'PLAYING' && gameState !== 'GAMEOVER' && gameState !== 'COLONY') {
            animationId = requestAnimationFrame(gameLoop);
            return;
        }

        if (camera.shakeIntensity > 0) {
            camera.shakeX = (Math.random() - 0.5) * camera.shakeIntensity;
            camera.shakeY = (Math.random() - 0.5) * camera.shakeIntensity;
            camera.shakeIntensity *= 0.9;
            if (camera.shakeIntensity < 0.5) camera.shakeIntensity = 0;
        }

        targetZoom = gameState === 'COLONY' ? targetZoom : 0.8;
        zoom += (targetZoom - zoom) * 0.05;

        if (gameState === 'PLAYING' || gameState === 'COLONY') handleSurvivalTick();

        // COLONY: walk on surface, update buildings, zoom in
        if (gameState === 'COLONY' && colonizedPlanet) {
            // Surface walk (A=left, D=right)
            if (keys.a) playerSurfaceAngle -= 0.018;
            if (keys.d) playerSurfaceAngle += 0.018;

            // Lock player to surface
            player.x = colonizedPlanet.x + Math.cos(playerSurfaceAngle) * (colonizedPlanet.radius + player.radius + 5);
            player.y = colonizedPlanet.y + Math.sin(playerSurfaceAngle) * (colonizedPlanet.radius + player.radius + 5);
            player.angle = playerSurfaceAngle + Math.PI / 2; // stand upright
            player.vx = 0; player.vy = 0;

            // Camera follow player on surface, zoomed in
            camera.x += (player.x - camera.x) * 0.1;
            camera.y += (player.y - camera.y) * 0.1;
            targetZoom = Math.min(2.5, 350 / colonizedPlanet.radius * 5);

            // Update buildings: production + turret firing
            if (colonizedPlanet.buildings) {
                colonizedPlanet.buildings.forEach(b => {
                    let bt = BUILDING_TYPES[b.type];
                    if (!bt) return;

                    if (bt.produces === 'food') stats.food = Math.min(stats.maxFood, stats.food + bt.ratePerTick);
                    if (bt.produces === 'water') stats.water = Math.min(stats.maxWater, stats.water + bt.ratePerTick);
                    if (bt.produces === 'hull') stats.hull = Math.min(stats.maxHull, stats.hull + bt.ratePerTick);

                    if (b.type === 'TURRET') {
                        b.shotTimer = (b.shotTimer || 0) - 1;
                        if (b.shotTimer <= 0) {
                            let bWorldX = colonizedPlanet.x + Math.cos(b.angle) * (colonizedPlanet.radius + bt.h);
                            let bWorldY = colonizedPlanet.y + Math.sin(b.angle) * (colonizedPlanet.radius + bt.h);
                            let nearest = null, nearestD = bt.range;
                            pirates.forEach(pir => {
                                let d = Math.hypot(pir.x - bWorldX, pir.y - bWorldY);
                                if (d < nearestD) { nearestD = d; nearest = pir; }
                            });
                            if (nearest) {
                                b.shotTimer = bt.fireRate;
                                b.firing = true;
                                let ang = Math.atan2(nearest.y - bWorldY, nearest.x - bWorldX);
                                projectiles.push(new Projectile(bWorldX, bWorldY, Math.cos(ang) * 22, Math.sin(ang) * 22, bt.damage, false));
                                AudioSys.sfx.shoot();
                                nearest.hp -= bt.damage;
                                if (nearest.hp <= 0) destroyPirate(nearest);
                            }
                        }
                    }
                });
            }

            // B key: open build menu
            if (keys.b && !player._bHandled) {
                player._bHandled = true;
                if (callbacks.onOpenBuilding) callbacks.onOpenBuilding(colonizedPlanet.buildings || []);
            }
            if (!keys.b) player._bHandled = false;

            // Sync HUD periodically
            if (Math.random() < 0.05) syncHUD();
        } else if (gameState !== 'COLONY') {
            // Normal space: reset zoom and colony angle
            targetZoom = 0.8;
        }

        ctx.setTransform(1, 0, 0, 1, 0, 0);

        ctx.save();
        ctx.translate(width / 2 + camera.shakeX, height / 2 + camera.shakeY);
        drawParallaxStars();
        ctx.scale(zoom, zoom);
        ctx.translate(-camera.x, -camera.y);

        if (gameState === 'PLAYING') {
            if (cloakTimer > 0) cloakTimer--;
            for (let i = flares.length - 1; i >= 0; i--) {
                flares[i].update();
                if (flares[i].life <= 0) flares.splice(i, 1);
            }

            suns.forEach(s => {
                if (Math.hypot(s.x - player.x, s.y - player.y) < 4000) {
                    let force = s.mass / 2500000;
                    let angle = Math.atan2(s.y - player.y, s.x - player.x);
                    player.vx += Math.cos(angle) * force;
                    player.vy += Math.sin(angle) * force;
                }
            });
        }

        suns.forEach(s => s.update());
        debris.forEach(d => d.update());

        for (let i = projectiles.length - 1; i >= 0; i--) {
            let prj = projectiles[i];
            if (gameState === 'PLAYING') prj.update(); else prj.draw();
            let hit = false;

            if (prj.isEnemy && gameState === 'PLAYING') {
                if (Math.hypot(prj.x - player.x, prj.y - player.y) < player.radius + prj.radius) {
                    takeDamage(prj.damage);
                    // Knockback no player
                    player.vx += prj.vx * 0.15;
                    player.vy += prj.vy * 0.15;
                    createExplosion(prj.x, prj.y, '#ff2a5f', 10);
                    AudioSys.sfx.hit();
                    hit = true;
                } else {
                    // Tiros piratas não atravessam planetas
                    for (let j = planets.length - 1; j >= 0; j--) {
                        let p = planets[j];
                        if (Math.hypot(prj.x - p.x, prj.y - p.y) < p.radius + prj.radius) {
                            p.radius -= prj.damage * 0.1;
                            p.mass = p.radius * p.radius;
                            createExplosion(prj.x, prj.y, p.baseColor || '#444', 5);
                            if (p.radius < 5) planets.splice(j, 1);
                            hit = true; break;
                        }
                    }
                }
            } else if (!prj.isEnemy && gameState === 'PLAYING') {
                for (let j = pirates.length - 1; j >= 0; j--) {
                    let pir = pirates[j];
                    if (Math.hypot(prj.x - pir.x, prj.y - pir.y) < pir.radius + prj.radius) {
                        pir.hp -= prj.damage;
                        // IMPACT WEIGHT / KNOCKBACK nas Naves Inimigas
                        pir.vx += prj.vx * 0.08;
                        pir.vy += prj.vy * 0.08;

                        if (stats.upgrades.explosive) applyAreaDamage(prj.x, prj.y, 80, prj.damage);
                        else createExplosion(prj.x, prj.y, '#ffaa00', 8);

                        AudioSys.sfx.hit();
                        if (pir.hp <= 0) destroyPirate(pir);
                        hit = true; break;
                    }
                }
                if (!hit) {
                    for (let j = planets.length - 1; j >= 0; j--) {
                        let p = planets[j];
                        if (Math.hypot(prj.x - p.x, prj.y - p.y) < p.radius + prj.radius) {
                            if (stats.upgrades.explosive) applyAreaDamage(prj.x, prj.y, 80, prj.damage);
                            else p.radius -= prj.damage * 0.2;
                            p.mass = p.radius * p.radius;
                            createExplosion(prj.x, prj.y, p.baseColor, 5);
                            AudioSys.sfx.hit();

                            if (p.radius < 5) {
                                let pts = 5; score += pts; gainXP(pts);
                                syncHUD();
                                createExplosion(p.x, p.y, p.baseColor, 20);
                                floatingTexts.push(new FloatingText(p.x, p.y, "+XP", '#fff'));
                                planets.splice(j, 1);
                            }
                            hit = true; break;
                        }
                    }
                }
            }
            if (hit || prj.life <= 0) projectiles.splice(i, 1);
        }

        if (gameState === 'PLAYING') {
            for (let i = pirates.length - 1; i >= 0; i--) {
                let pir = pirates[i];
                pir.update();
                if (!player.hyperSpeed) {
                    let dist = Math.hypot(player.x - pir.x, player.y - pir.y);
                    if (dist < player.radius + pir.radius) {
                        resolveCollision(player, pir, 0.8);
                        takeDamage(10);
                        createExplosion(pir.x, pir.y, '#ff2a5f', 15);
                    }
                }

                // Pirata vs Planetas (Rajada Gravitacional destroi o Pirata!)
                for (let j = planets.length - 1; j >= 0; j--) {
                    let p = planets[j];
                    if (Math.hypot(pir.x - p.x, pir.y - p.y) < pir.radius + p.radius) {
                        let pSpeed = Math.hypot(p.vx, p.vy);
                        if (pSpeed > 3.0) {
                            // Smacked by repelled planet!
                            pir.hp = 0;
                            destroyPirate(pir);
                            createExplosion(pir.x, pir.y, '#ffaa00', 40);
                            AudioSys.sfx.explosion();
                            break;
                        } else {
                            resolveCollision(pir, p, 0.5);
                        }
                    }
                }
            }

            for (let i = planets.length - 1; i >= 0; i--) {
                let p = planets[i];
                if (Math.abs(p.x - camera.x) < (p.radius + 4000) / zoom && Math.abs(p.y - camera.y) < (p.radius + 4000) / zoom) p.update();

                if (!player.hyperSpeed) {
                    let dist = Math.hypot(player.x - p.x, player.y - p.y);
                    if (dist < player.radius + p.radius) {
                        resolveCollision(player, p, 0.6);
                        stats.hull -= 5;
                        syncHUD();
                        createExplosion(player.x, player.y, '#fff', 5);
                        triggerShake(5);
                        if (stats.hull <= 0) die("Destruído por impacto orbital.");
                    }
                }
            }

            for (let i = extractorParticles.length - 1; i >= 0; i--) {
                extractorParticles[i].update();
                if (extractorParticles[i].life <= 0) extractorParticles.splice(i, 1);
            }
        } else {
            planets.forEach(p => {
                if (Math.abs(p.x - camera.x) < 3000 / zoom && Math.abs(p.y - camera.y) < 3000 / zoom) p.draw();
            });
        }

        if (gameState === 'PLAYING') {
            for (let i = gravityWaves.length - 1; i >= 0; i--) {
                gravityWaves[i].update();
                if (gravityWaves[i].life <= 0) gravityWaves.splice(i, 1);
            }
        }

        if (gameState === 'PLAYING') player.update();
        else if (gameState === 'COLONY') {
            // Surface colony: draw player + allow E/B keys
            player.draw();
            player.useEKey();
        }

        for (let i = particles.length - 1; i >= 0; i--) {
            if (gameState === 'PLAYING') particles[i].update(); else particles[i].draw();
            if (particles[i].life <= 0) particles.splice(i, 1);
        }
        for (let i = floatingTexts.length - 1; i >= 0; i--) {
            if (gameState === 'PLAYING') floatingTexts[i].update(); else floatingTexts[i].draw();
            if (floatingTexts[i].life <= 0) floatingTexts.splice(i, 1);
        }

        if (multiConfig.active) {
            // Envia estado a cada 2 frames aprox
            if (Math.random() < 0.5) {
                networkManager.send(JSON.stringify({
                    type: 'PLAYER',
                    name: playerName,
                    score: score,
                    level: stats.level,
                    isCloaked: cloakTimer > 0,
                    laserMode: stats.laserMode,
                    x: player.x, y: player.y,
                    angle: player.angle,
                    hyperSpeed: player.hyperSpeed,
                    mouse: keys.mouse, rightMouse: keys.rightMouse
                }));
            }

            let uiList = [{ name: playerName, score: Math.floor(score) }];

            for (let pid in connectedPeers) {
                let cp = connectedPeers[pid];
                let d = cp.data;
                cp.obj.x += (d.x - cp.obj.x) * 0.3;
                cp.obj.y += (d.y - cp.obj.y) * 0.3;
                cp.obj.angle += (d.angle - cp.obj.angle) * 0.3;
                cp.obj.hyperSpeed = d.hyperSpeed;
                cp.obj.radius = 25 + ((d.level || 1) - 1) * 1.5;

                ctx.save();
                if (d.isCloaked) ctx.globalAlpha = 0.3;
                cp.obj.draw();
                ctx.restore();

                // Simple laser mock
                if (d.rightMouse) {
                    ctx.beginPath();
                    ctx.moveTo(cp.obj.x, cp.obj.y);
                    ctx.lineTo(cp.obj.x + Math.cos(cp.obj.angle) * 400, cp.obj.y + Math.sin(cp.obj.angle) * 400);
                    let beamColor = '#ffaa00';
                    if (d.laserMode === 'PIERCE') beamColor = '#ff0033';
                    else if (d.laserMode === 'EXTRACT') beamColor = '#00e5ff';
                    ctx.strokeStyle = beamColor;
                    ctx.lineWidth = 3;
                    ctx.stroke();
                }

                uiList.push({ name: d.name || 'Piloto', score: Math.floor(d.score || 0) });
            }

            if (Math.random() < 0.05 && callbacks.onUpdatePlayers) {
                callbacks.onUpdatePlayers(uiList.sort((a, b) => b.score - a.score));
            }
        }

        // Radar Pips
        if (stats.upgrades.scanner && gameState === 'PLAYING') {
            ctx.save();
            let halfW = (width / 2) / zoom, halfH = (height / 2) / zoom;
            let drawPip = (x, y, color) => {
                let dx = x - camera.x, dy = y - camera.y;
                if (Math.abs(dx) > halfW || Math.abs(dy) > halfH) {
                    let scale = Math.min(Math.abs((halfW - 30) / dx), Math.abs((halfH - 30) / dy));
                    ctx.fillStyle = color;
                    ctx.beginPath(); ctx.arc(camera.x + dx * scale, camera.y + dy * scale, 6, 0, Math.PI * 2); ctx.fill();
                    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke();
                }
            };
            pirates.forEach(p => drawPip(p.x, p.y, '#ff2a5f'));
            planets.forEach(p => { if (p.radius > 20) drawPip(p.x, p.y, '#00e5ff'); });
            ctx.restore();
        }

        ctx.restore();

        if (planets.length < 60 && Math.random() < 0.05 && gameState === 'PLAYING') {
            let a = Math.random() * Math.PI * 2;
            let dist = (width / zoom) * (Math.random() * 0.5 + 1.2);
            let isGiant = Math.random() < 0.45;
            let r = isGiant ? (Math.random() * 500 + 350) : (Math.random() * 180 + 80);
            planets.push(new Planet(player.x + Math.cos(a) * dist, player.y + Math.sin(a) * dist, r));
        }

        if (pirates.length < 20 && Math.random() < 0.02 && gameState === 'PLAYING') {
            let squadSize = Math.floor(Math.random() * 4) + 1;
            let a = Math.random() * Math.PI * 2;
            let r = (width / zoom) * 1.5;
            let cx = player.x + Math.cos(a) * r;
            let cy = player.y + Math.sin(a) * r;
            for (let j = 0; j < squadSize; j++) pirates.push(new PirateShip(cx + (Math.random() - 0.5) * 300, cy + (Math.random() - 0.5) * 300));
        }

        animationId = requestAnimationFrame(gameLoop);
    }

    const onKeyDown = (e) => {
        let key = e.key.toLowerCase();
        if (key === 'w') keys.w = true;
        if (key === 'a') keys.a = true;
        if (key === 's') keys.s = true;
        if (key === 'd') keys.d = true;
        if (e.code === 'Space') { keys.space = true; e.preventDefault(); }
        if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') { keys.shift = true; }
        if (key === 'e') keys.e = true;
        if (key === 'z' && stats.upgrades.cloak && cloakTimer <= 0) { cloakTimer = 600; AudioSys.playTone(300, 'sine', 0.2, 0.5, 400); }
        if (key === 'x' && stats.upgrades.flares && stats.inv.scrap >= 2) {
            stats.inv.scrap -= 2; syncHUD();
            flares.push({
                x: player.x, y: player.y, vx: (Math.random() - 0.5) * 10, vy: (Math.random() - 0.5) * 10, life: 300,
                update: function () { this.x += this.vx; this.y += this.vy; this.life--; if (Math.random() < 0.5) particles.push(new Particle(this.x, this.y, '#ffaa00', 0, 0, 5)); }
            });
            AudioSys.playTone(800, 'square', 0.1, 0.1, 1000);
        }
        if (key === 'q') {
            const modes = ['EXTRACT', 'REPULSE', 'PIERCE'];
            stats.laserMode = modes[(modes.indexOf(stats.laserMode) + 1) % modes.length];
            syncHUD();
        }
        if (key === 'c') {
            if (gameState === 'PLAYING') {
                gameState = 'CRAFTING';
                if (callbacks.onOpenCrafting) callbacks.onOpenCrafting();
            }
        }
        if (key === 'b') keys.b = true;
    };

    const onKeyUp = (e) => {
        let key = e.key.toLowerCase();
        if (key === 'w' || key === 'arrowup') keys.w = false;
        if (key === 'a' || key === 'arrowleft') keys.a = false;
        if (key === 's' || key === 'arrowdown') keys.s = false;
        if (key === 'd' || key === 'arrowright') keys.d = false;
        if (e.code === 'Space') keys.space = false;
        if (key === 'e') keys.e = false;
        if (key === 'b') keys.b = false;
    };

    const onMouseMove = (e) => {
        mouseScreen.x = e.clientX;
        mouseScreen.y = e.clientY;
    };

    const onMouseDown = (e) => {
        if (e.button === 0) keys.mouse = true;
        if (e.button === 2) keys.rightMouse = true;
    };

    const onMouseUp = (e) => {
        if (e.button === 0) keys.mouse = false;
        if (e.button === 2) keys.rightMouse = false;
    };

    const onContextMenu = (e) => e.preventDefault();

    const onResize = () => {
        width = canvas.width = window.innerWidth;
        height = canvas.height = window.innerHeight;
    };

    return {
        start: () => {
            AudioSys.init();
            window.addEventListener('resize', onResize);
            window.addEventListener('keydown', onKeyDown, { passive: false });
            window.addEventListener('keyup', onKeyUp);
            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mousedown', onMouseDown);
            window.addEventListener('mouseup', onMouseUp);
            window.addEventListener('contextmenu', onContextMenu);
            onResize();

            player = new Player();
            spawnWorldEntities();

            score = 0; stats.level = 1; stats.xp = 0; stats.xpNext = 50;
            stats.dmgMult = 1.0; stats.fireRate = 500; stats.multishot = 1;
            stats.speed = 1.0; stats.recoil = 1.0;
            stats.food = 100; stats.maxFood = 100;
            stats.water = 100; stats.maxWater = 100;
            stats.hull = 100; stats.maxHull = 100;
            stats.inv = { ice: 0, leaves: 0, fruits: 0, minerals: 0, scrap: 0 };
            stats.upgrades = { homing: false, explosive: false };
            stats.laserMode = 'EXTRACT';

            syncHUD();
            gameState = 'PLAYING';
            animationId = requestAnimationFrame(gameLoop);
        },
        destroy: () => {
            gameState = 'STOPPED';
            cancelAnimationFrame(animationId);
            window.removeEventListener('resize', onResize);
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mousedown', onMouseDown);
            window.removeEventListener('mouseup', onMouseUp);
            window.removeEventListener('contextmenu', onContextMenu);
        },
        resume: () => {
            gameState = 'PLAYING';
        },
        leaveColony,
        placeBuilding: (type) => {
            if (gameState !== 'COLONY' || !colonizedPlanet) return { ok: false, reason: 'Não está em colônia' };
            let bt = BUILDING_TYPES[type];
            if (!bt) return { ok: false, reason: 'Tipo inválido' };
            // Check resources
            let c = bt.cost;
            if (c.ice && stats.inv.ice < c.ice) return { ok: false, reason: `Faltam ${c.ice} Gelo` };
            if (c.leaves && stats.inv.leaves < c.leaves) return { ok: false, reason: `Faltam ${c.leaves} Folhas` };
            if (c.fruits && stats.inv.fruits < c.fruits) return { ok: false, reason: `Faltam ${c.fruits} Frutas` };
            if (c.minerals && stats.inv.minerals < c.minerals) return { ok: false, reason: `Faltam ${c.minerals} Minérios` };
            if (c.scrap && stats.inv.scrap < c.scrap) return { ok: false, reason: `Faltam ${c.scrap} Sucata` };
            // Deduct
            if (c.ice) stats.inv.ice -= c.ice;
            if (c.leaves) stats.inv.leaves -= c.leaves;
            if (c.fruits) stats.inv.fruits -= c.fruits;
            if (c.minerals) stats.inv.minerals -= c.minerals;
            if (c.scrap) stats.inv.scrap -= c.scrap;
            if (!colonizedPlanet.buildings) colonizedPlanet.buildings = [];
            colonizedPlanet.buildings.push({ angle: playerSurfaceAngle, type, shotTimer: 0, firing: false });
            createExplosion(player.x, player.y, bt.color, 15);
            syncHUD();
            return { ok: true };
        },
        getBuildingTypes: () => BUILDING_TYPES,
        craftItem: (id) => {
            if (id === 'water_supply' && stats.inv.ice >= 2 && stats.inv.leaves >= 1) {
                stats.inv.ice -= 2; stats.inv.leaves -= 1;
                stats.water = Math.min(stats.maxWater, stats.water + 40);
                syncHUD(); return true;
            }
            if (id === 'canned_food' && stats.inv.fruits >= 2 && stats.inv.leaves >= 1) {
                stats.inv.fruits -= 2; stats.inv.leaves -= 1;
                stats.food = Math.min(stats.maxFood, stats.food + 40);
                syncHUD(); return true;
            }
            if (id === 'hull_repair' && stats.inv.minerals >= 3 && stats.inv.scrap >= 1) {
                stats.inv.minerals -= 3; stats.inv.scrap -= 1;
                stats.hull = Math.min(stats.maxHull, stats.hull + 30);
                syncHUD(); return true;
            }
            if (id === 'homing_shots' && !stats.upgrades.homing && stats.inv.scrap >= 10 && stats.inv.minerals >= 15) {
                stats.inv.scrap -= 10; stats.inv.minerals -= 15;
                stats.upgrades.homing = true;
                syncHUD(); return true;
            }
            if (id === 'combat_drones' && !stats.upgrades.combatDrones && stats.inv.scrap >= 35 && stats.inv.minerals >= 30) {
                stats.inv.scrap -= 35; stats.inv.minerals -= 30;
                stats.upgrades.combatDrones = true;
                syncHUD(); return true;
            }
            if (id === 'repair_drones' && !stats.upgrades.repairDrones && stats.inv.minerals >= 50 && stats.inv.ice >= 30) {
                stats.inv.minerals -= 50; stats.inv.ice -= 30;
                stats.upgrades.repairDrones = true;
                syncHUD(); return true;
            }
            if (id === 'scanner' && !stats.upgrades.scanner && stats.inv.scrap >= 20 && stats.inv.leaves >= 20) {
                stats.inv.scrap -= 20; stats.inv.leaves -= 20;
                stats.upgrades.scanner = true;
                syncHUD(); return true;
            }
            if (id === 'hyperdrive' && !stats.upgrades.hyperdrive && stats.inv.scrap >= 50 && stats.inv.ice >= 50) {
                stats.inv.scrap -= 50; stats.inv.ice -= 50;
                stats.upgrades.hyperdrive = true;
                syncHUD(); return true;
            }
            if (id === 'cloak' && !stats.upgrades.cloak && stats.inv.scrap >= 40 && stats.inv.leaves >= 30) {
                stats.inv.scrap -= 40; stats.inv.leaves -= 30;
                stats.upgrades.cloak = true;
                syncHUD(); return true;
            }
            if (id === 'flares' && !stats.upgrades.flares && stats.inv.minerals >= 10 && stats.inv.ice >= 10) {
                stats.inv.minerals -= 10; stats.inv.ice -= 10;
                stats.upgrades.flares = true;
                syncHUD(); return true;
            }
            if (id === 'explosive_shots' && !stats.upgrades.explosive && stats.inv.minerals >= 20) {
                stats.inv.minerals -= 20;
                stats.upgrades.explosive = true;
                syncHUD(); return true;
            }
            return false;
        },
        processNetworkData: (data, peerId) => {
            try {
                let msg = JSON.parse(data);
                if (msg.type === 'PLAYER') {
                    if (!connectedPeers[peerId]) {
                        connectedPeers[peerId] = { data: msg, obj: new Player() };
                        connectedPeers[peerId].obj.x = msg.x;
                        connectedPeers[peerId].obj.y = msg.y;
                        connectedPeers[peerId].obj.angle = msg.angle;
                    } else {
                        connectedPeers[peerId].data = msg;
                    }
                }
            } catch (e) { }
        }
    };
}
