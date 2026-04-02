import { useEffect, useRef, useState } from 'react';
import { createGameEngine } from './game/Engine';
import { networkManager } from './game/NetworkManager';
import './index.css';

function App() {
  const canvasRef = useRef(null);
  const engineRef = useRef(null);

  const [gameState, setGameState] = useState('START'); // START, LOBBY, JOINING, PLAYING, COLONY, CRAFTING, LEVEL_UP, GAMEOVER
  const [colonyPlanet, setColonyPlanet] = useState(null);
  const [multiplayerConfig, setMultiplayerConfig] = useState({ active: false, isHost: false, hostId: '' });
  const [playerName, setPlayerName] = useState('');
  const [playersList, setPlayersList] = useState([]);
  const [hud, setHud] = useState({
    score: 0, level: 1, xp: 0, xpNext: 50,
    weaponStr: 'Dano: 2.0 | Tiros: 1',
    biomeName: 'Setor Alpha', biomeColor: '#ffffff',
    showWormAlert: false,
    shield: 100, maxShield: 100,
    food: 100, maxFood: 100,
    water: 100, maxWater: 100,
    hull: 100, maxHull: 100,
    inv: { ice: 0, leaves: 0, fruits: 0, minerals: 0, scrap: 0 },
    laserMode: 'EXTRACT'
  });

  const [perkChoices, setPerkChoices] = useState([]);
  const [perkCallback, setPerkCallback] = useState(null);
  const [deathReason, setDeathReason] = useState('');
  const [buildPanelOpen, setBuildPanelOpen] = useState(false);
  const [buildMsg, setBuildMsg] = useState('');

  const initEngine = () => {
    if (engineRef.current) engineRef.current.destroy();

    engineRef.current = createGameEngine(canvasRef.current, {
      onUpdateHUD: (newHud) => {
        setHud(prev => ({ ...prev, ...newHud }));
      },
      onLevelUp: (choices, callback) => {
        setPerkChoices(choices);
        setPerkCallback(() => callback);
        setGameState('LEVEL_UP');
      },
      onGameOver: (reason, finalScore) => {
        setDeathReason(reason);
        setHud(prev => ({ ...prev, score: finalScore }));
        setGameState('GAMEOVER');
      },
      onOpenCrafting: () => {
        setGameState('CRAFTING');
      },
      onEnterColony: ({ planet }) => {
        setColonyPlanet(planet);
        setGameState('COLONY');
      },
      onLeaveColony: () => {
        setColonyPlanet(null);
        setBuildPanelOpen(false);
        setGameState('PLAYING');
      },
      onOpenBuilding: () => {
        setBuildPanelOpen(p => !p);
      },
      onUpdatePlayers: (list) => {
        setPlayersList(list);
      }
    }, overrideConfig || multiplayerConfig, playerName);
  };

  useEffect(() => {
    if (!engineRef.current) initEngine();
    return () => {
      if (engineRef.current) engineRef.current.destroy();
    };
  }, []);

  const startGame = (multiplayer = false, isHost = false) => {
    setMultiplayerConfig(prev => ({ ...prev, active: multiplayer, isHost }));
    // Do not init engine immediately if multiplayer (wait for connection)
    if (!multiplayer) {
      initEngine();
      engineRef.current.start();
      setGameState('PLAYING');
    }
  };

  const GLOBAL_ROOM_ID = 'planet-eater-global-master';

  const handleJoinGlobal = () => {
    if (!playerName.trim()) return alert('Insira seu nome.');
    setGameState('JOINING');

    networkManager.setCallbacks({
      onConnect: () => {
        startGame(true, false);
        setTimeout(() => {
          if (engineRef.current) engineRef.current.destroy();
          initEngine({ active: true, isHost: false });
          engineRef.current.start();
          setGameState('PLAYING');
        }, 50);
      },
      onError: (err) => {
        if (err && err.type === 'taken') {
          // Room exists, join it
          networkManager.joinGame(GLOBAL_ROOM_ID);
        } else {
          console.error("Multiplayer Error:", err);
          alert("Network Error: " + (err ? err.type : 'Unknown'));
          setGameState('START');
        }
      },
      onData: (data, senderId) => {
        if (engineRef.current && engineRef.current.processNetworkData) {
          engineRef.current.processNetworkData(data, senderId);
        }
      },
      onDisconnect: () => {
        console.log("Disconnected from network");
      }
    });

    networkManager.hostGame(GLOBAL_ROOM_ID, (id) => {
      // Room didn't exist, we created it!
      setMultiplayerConfig(prev => ({ ...prev, active: true, isHost: true }));
      startGame(true, true);
      setTimeout(() => {
        if (engineRef.current) engineRef.current.destroy();
        initEngine({ active: true, isHost: true });
        engineRef.current.start();
        setGameState('PLAYING');
      }, 50);
    });
  };

  const handlePerkSelect = (perk) => {
    if (perkCallback) perkCallback(perk);
    setGameState('PLAYING');
  };

  const handleCraft = (id) => {
    if (engineRef.current) {
      if (engineRef.current.craftItem(id)) {
        // Sucesso
        console.log("Crafted " + id);
      }
    }
  };

  const closeCrafting = () => {
    if (engineRef.current) engineRef.current.resume();
    setGameState('PLAYING');
  };

  const leaveColony = () => {
    if (engineRef.current) engineRef.current.leaveColony();
  };

  return (
    <>
      <div id="instructions">
        WASD/A↔D: Mover | MOUSE ESQ: Atirar | MOUSE DIR: Raio | Q: Raio | C: Fabricar | ESPAÇO: Hiper | E: Colonizar/Onda | B: Construir (na colônia)
      </div>

      {(gameState === 'PLAYING' || gameState === 'LEVEL_UP' || gameState === 'CRAFTING' || gameState === 'COLONY') && (
        <div id="ui-container">
          <div className="glass-panel" style={{ width: '320px' }}>
            <h1>Cruzador de Sobrevivência</h1>
            <div className="stat">Score: <span>{hud.score}</span></div>
            <div className="level-text">
              <span>Nível <span>{hud.level}</span></span>
              <span>{hud.weaponStr}</span>
            </div>

            <div className="xp-container">
              <div className="xp-bar" style={{ width: `${(hud.xp / hud.xpNext) * 100}%` }}></div>
            </div>

            {/* INVENTÁRIO (Novos Recursos Físicos) */}
            <div style={{ marginTop: '15px', padding: '10px', background: 'rgba(0,0,0,0.5)', borderRadius: '8px' }}>
              <div style={{ fontSize: '0.8rem', color: '#ffaa00', marginBottom: '5px' }}>PORÃO DE CARGA</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px', fontSize: '0.8rem' }}>
                <div>🧊 Gelo: <span style={{ color: '#fff' }}>{hud.inv.ice}</span></div>
                <div>🍃 Folhas: <span style={{ color: '#fff' }}>{hud.inv.leaves}</span></div>
                <div>🍎 Frutas: <span style={{ color: '#fff' }}>{hud.inv.fruits}</span></div>
                <div>⛏️ Minérios: <span style={{ color: '#fff' }}>{hud.inv.minerals}</span></div>
                <div>⚙️ Sucata: <span style={{ color: '#fff' }}>{hud.inv.scrap}</span></div>
              </div>
            </div>

            {/* Barras de Sobrevivência */}
            <div style={{ marginTop: '15px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div>
                <div style={{ fontSize: '0.75rem', color: '#0088ff', display: 'flex', justifyContent: 'space-between' }}>
                  <span>ESCUDOS DEFLETORES</span>
                  <span>{Math.floor(hud.shield)}/{hud.maxShield}</span>
                </div>
                <div style={{ width: '100%', height: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', overflow: 'hidden' }}>
                  <div style={{ width: `${Math.max(0, hud.shield) / hud.maxShield * 100}%`, height: '100%', background: '#0088ff', transition: 'width 0.2s', boxShadow: hud.shield > 0 ? '0 0 8px #0088ff' : 'none' }}></div>
                </div>
              </div>

              <div>
                <div style={{ fontSize: '0.75rem', color: '#00e5ff', display: 'flex', justifyContent: 'space-between' }}>
                  <span>INTEGRIDADE DO CASCO</span>
                  <span>{Math.floor(hud.hull)}/{hud.maxHull}</span>
                </div>
                <div style={{ width: '100%', height: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', overflow: 'hidden' }}>
                  <div style={{ width: `${Math.max(0, hud.hull) / hud.maxHull * 100}%`, height: '100%', background: '#00e5ff', transition: 'width 0.2s' }}></div>
                </div>
              </div>

              <div>
                <div style={{ fontSize: '0.75rem', color: '#00ff66', display: 'flex', justifyContent: 'space-between' }}>
                  <span>RESERVAS DE COMIDA</span>
                  <span>{Math.floor(hud.food)}/{hud.maxFood}</span>
                </div>
                <div style={{ width: '100%', height: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', overflow: 'hidden' }}>
                  <div style={{ width: `${Math.max(0, hud.food) / hud.maxFood * 100}%`, height: '100%', background: '#00ff66', transition: 'width 0.2s' }}></div>
                </div>
              </div>

              <div>
                <div style={{ fontSize: '0.75rem', color: '#4287ff', display: 'flex', justifyContent: 'space-between' }}>
                  <span>RESERVAS DE ÁGUA</span>
                  <span>{Math.floor(hud.water)}/{hud.maxWater}</span>
                </div>
                <div style={{ width: '100%', height: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', overflow: 'hidden' }}>
                  <div style={{ width: `${Math.max(0, hud.water) / hud.maxWater * 100}%`, height: '100%', background: '#4287ff', transition: 'width 0.2s' }}></div>
                </div>
              </div>
            </div>

            <div className="level-text" style={{ marginTop: '15px' }}>
              Bioma: <span style={{ color: hud.biomeColor }}>{hud.biomeName}</span>
            </div>

            <div style={{ marginTop: '10px', fontSize: '0.8rem', color: hud.laserMode === 'EXTRACT' ? '#00e5ff' : (hud.laserMode === 'PIERCE' ? '#ff0033' : '#ffaa00'), fontWeight: 'bold' }}>
              MODO RAIO (Q): {hud.laserMode === 'EXTRACT' ? 'EXTRAÇÃO DE MATÉRIA' : (hud.laserMode === 'PIERCE' ? 'FEIXE PERFURANTE' : 'RAJADA GRAVITACIONAL')}
            </div>

            <button className="btn" style={{ marginTop: '15px', padding: '8px', fontSize: '0.9rem' }} onClick={() => setGameState('CRAFTING')}>FABRICADOR (C)</button>
          </div>

          {/* Tabela de Jogadores - Canto Superior Direito */}
          {multiplayerConfig.active && (
            <div className="glass-panel" style={{ position: 'fixed', top: '20px', right: '20px', width: '220px' }}>
              <h3 style={{ color: '#00e5ff', fontSize: '0.9rem', marginBottom: '10px' }}>Tripulação Online ({playersList.length})</h3>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {playersList.map((p, i) => (
                  <li key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '5px', paddingBottom: '3px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                    <span style={{ color: '#fff' }}>{p.name} {p.name === playerName ? '(Você)' : ''}</span>
                    <span style={{ color: '#00ff66' }}>{p.score || 0} pts</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Alerta de Leviatã */}
      <div className="biome-alert" style={{ display: hud.showWormAlert ? 'block' : 'none' }}>
        AVISO: LEVIATÃ DETETADO
      </div>

      {/* Menu Iniciar */}
      {gameState === 'START' && (
        <div className="overlay-screen">
          <div className="menu-card">
            <h2>COMEDOR DE PLANETAS</h2>
            <p style={{ color: '#aaa', lineHeight: 1.6 }}>
              És o piloto de um Cruzador Extrator Massivo.<br />
              Sobrevive extraindo matéria-prima de planetas para <b>Fabricar</b> Comida, Água e Upgrades.<br />
              Atenção aos Piratas de elite e aos destroços que deixam.<br />
            </p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '20px' }}>
              <button className="btn" onClick={() => startGame(false)}>JOGAR SOZINHO</button>
              <button className="btn" style={{ borderColor: '#00e5ff' }} onClick={() => setGameState('LOBBY')}>MULTIPLAYER (BETA)</button>
            </div>
            <p style={{ fontSize: '0.8rem', color: '#555', marginTop: '20px' }}>
              Requer rato para mirar. Sobrevive o máximo possível.
            </p>
          </div>
        </div>
      )}

      {/* Menu Lobby Multiplayer */}
      {gameState === 'LOBBY' && (
        <div className="overlay-screen">
          <div className="menu-card">
            <h2 style={{ color: '#00e5ff' }}>SALA GLOBAL MULTIPLAYER</h2>
            <div style={{ margin: '20px 0' }}>
              <input
                id="nameInput"
                type="text"
                placeholder="SEU NOME DE PILOTO..."
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                style={{ width: '80%', padding: '10px', background: '#000', color: '#fff', border: '1px solid #00e5ff', borderRadius: '4px', textAlign: 'center' }}
              />
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button className="btn" onClick={handleJoinGlobal}>ENTRAR NA GALÁXIA</button>
            </div>
            <button className="btn" style={{ borderColor: '#888', fontSize: '0.8rem', marginTop: '15px' }} onClick={() => setGameState('START')}>VOLTAR</button>
          </div>
        </div>
      )}

      {gameState === 'JOINING' && (
        <div className="overlay-screen">
          <div className="menu-card">
            <h2 style={{ color: '#ffaa00' }}>CONECTANDO...</h2>
            <p>Estabelecendo link com a rede da Federação.</p>
          </div>
        </div>
      )}

      {/* Colony HUD Banner + Build Panel */}
      {gameState === 'COLONY' && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 50,
          background: 'linear-gradient(180deg, rgba(0,30,8,0.95) 0%, rgba(0,30,8,0) 100%)',
          padding: '12px 20px', display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap'
        }}>
          <span style={{ color: '#00ff66', fontWeight: 'bold', fontSize: '1rem' }}>🏠 COLÔNIA ATIVA</span>
          <span style={{ color: '#00e5ff', fontSize: '0.85rem' }}>🛡️ {Math.floor(hud.hull)}/{hud.maxHull}</span>
          <span style={{ color: '#00ff66', fontSize: '0.85rem' }}>🍎 {Math.floor(hud.food)}/{hud.maxFood}</span>
          <span style={{ color: '#4287ff', fontSize: '0.85rem' }}>💧 {Math.floor(hud.water)}/{hud.maxWater}</span>
          <span style={{ color: '#aaa', fontSize: '0.8rem' }}>🧊{hud.inv.ice} 🍃{hud.inv.leaves} 🍎{hud.inv.fruits} ⛏️{hud.inv.minerals} ⚙️{hud.inv.scrap}</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
            <button className="btn" style={{ padding: '6px 14px', fontSize: '0.8rem' }}
              onClick={() => setBuildPanelOpen(p => !p)}>🔨 Construir [B]</button>
            <button className="btn" style={{ padding: '6px 14px', fontSize: '0.8rem', borderColor: '#ff2a5f', background: 'rgba(80,0,0,0.5)' }}
              onClick={leaveColony}>🚀 Lançar [E]</button>
          </div>
        </div>
      )}

      {/* Build Panel (floating, non-blocking) */}
      {gameState === 'COLONY' && buildPanelOpen && (
        <div style={{
          position: 'fixed', top: '70px', right: '20px', zIndex: 60,
          background: 'rgba(0,15,5,0.95)', border: '1px solid #00ff66', borderRadius: '12px',
          padding: '18px', width: '280px', backdropFilter: 'blur(8px)'
        }}>
          <div style={{ color: '#00ff66', fontWeight: 'bold', marginBottom: '12px', fontSize: '0.95rem' }}>🔨 CONSTRUÇÕES</div>
          {buildMsg && <div style={{ color: buildMsg.startsWith('✅') ? '#00ff66' : '#ff2a5f', marginBottom: '10px', fontSize: '0.85rem' }}>{buildMsg}</div>}
          {[['FARM', '🌾 Fazenda', '3🍃 + 2🍎', 'Produz comida passivamente'],
          ['PURIFIER', '💧 Purificador', '4🧊', 'Produz água passivamente'],
          ['GENERATOR', '⚡ Gerador', '5⛏️', 'Regenera casco passivamente'],
          ['TURRET', '🔫 Torreta', '3⛏️ + 3⚙️', 'Auto-atira em piratas próximos'],
          ].map(([type, name, cost, desc]) => (
            <div key={type}
              onClick={() => handleBuild(type)}
              style={{
                background: 'rgba(0,255,102,0.05)', border: '1px solid rgba(0,255,102,0.2)',
                borderRadius: '8px', padding: '10px', marginBottom: '8px', cursor: 'pointer'
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,255,102,0.12)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(0,255,102,0.05)'}
            >
              <div style={{ color: '#fff', fontSize: '0.88rem', fontWeight: 'bold' }}>{name}</div>
              <div style={{ color: '#ffaa00', fontSize: '0.75rem' }}>Custo: {cost}</div>
              <div style={{ color: '#888', fontSize: '0.72rem' }}>{desc}</div>
            </div>
          ))}
          <button className="btn" style={{ width: '100%', padding: '6px', fontSize: '0.8rem', marginTop: '4px' }}
            onClick={() => setBuildPanelOpen(false)}>Fechar</button>
        </div>
      )}

      {/* Menu Crafting */}
      {gameState === 'CRAFTING' && (
        <div className="overlay-screen">
          <div className="menu-card" style={{ maxWidth: '600px', width: '90%' }}>
            <h2 style={{ color: '#ffaa00' }}>FABRICADOR CENTRAL</h2>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '15px', marginTop: '20px' }}>
              <div className="perk-card" style={{ borderColor: '#4287ff' }} onClick={() => handleCraft('water_supply')}>
                <div className="perk-title" style={{ color: '#4287ff' }}>Pack de Água (+40)</div>
                <div className="perk-desc">Refina gelo com filtros orgânicos.</div>
                <div style={{ fontSize: '0.8rem', marginTop: '10px', color: '#aaa' }}>Custo: 2 Gelo | 1 Folha</div>
              </div>

              <div className="perk-card" style={{ borderColor: '#00ff66' }} onClick={() => handleCraft('canned_food')}>
                <div className="perk-title" style={{ color: '#00ff66' }}>Comida Enlatada (+40)</div>
                <div className="perk-desc">Sintetiza rações calóricas.</div>
                <div style={{ fontSize: '0.8rem', marginTop: '10px', color: '#aaa' }}>Custo: 2 Frutas | 1 Folha</div>
              </div>

              <div className="perk-card" style={{ borderColor: '#00e5ff' }} onClick={() => handleCraft('hull_repair')}>
                <div className="perk-title" style={{ color: '#00e5ff' }}>Reparo de Casco (+30)</div>
                <div className="perk-desc">Funde minérios para tapar buracos.</div>
                <div style={{ fontSize: '0.8rem', marginTop: '10px', color: '#aaa' }}>Custo: 3 Minérios | 1 Sucata</div>
              </div>

              <div className="perk-card" style={{ borderColor: '#ff2a5f' }} onClick={() => handleCraft('homing_shots')}>
                <div className="perk-title" style={{ color: '#ff2a5f' }}>Mísseis Teleguiados</div>
                <div className="perk-desc">UPGRADE: Projéteis seguem os piratas.</div>
                <div style={{ fontSize: '0.8rem', marginTop: '10px', color: '#aaa' }}>Custo: 10 Sucata | 15 Minérios</div>
              </div>

              <div className="perk-card" style={{ borderColor: '#ffaa00' }} onClick={() => handleCraft('explosive_shots')}>
                <div className="perk-title" style={{ color: '#ffaa00' }}>Balas Explosivas</div>
                <div className="perk-desc">UPGRADE: Projéteis criam explosões ao redor.</div>
                <div style={{ fontSize: '0.8rem', marginTop: '10px', color: '#aaa' }}>Custo: 20 Minérios</div>
              </div>
            </div>

            <button className="btn" style={{ marginTop: '30px' }} onClick={closeCrafting}>FECHAR (C)</button>
          </div>
        </div>
      )}

      {/* Menu Evolução */}
      {gameState === 'LEVEL_UP' && (
        <div className="overlay-screen">
          <div className="menu-card">
            <h2 style={{ color: '#00e5ff' }}>UPGRADE SISTÉMICO</h2>
            <div className="cards-container">
              {perkChoices.map((perk, i) => (
                <div key={i} className="perk-card" onClick={() => handlePerkSelect(perk)}>
                  <div className="perk-title">{perk.name}</div>
                  <div className="perk-desc">{perk.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Menu Game Over */}
      {gameState === 'GAMEOVER' && (
        <div className="overlay-screen">
          <div className="menu-card danger-card">
            <h2>MISSÃO FRACASSADA</h2>
            <p style={{ color: '#aaa' }}>{deathReason}</p>
            <div className="stat">Score Final: <span>{hud.score}</span></div>
            <button className="btn" onClick={startGame}>NOVO CICLO</button>
          </div>
        </div>
      )}

      <canvas ref={canvasRef} id="game-canvas" onContextMenu={(e) => e.preventDefault()}></canvas>
    </>
  );
}

export default App;
