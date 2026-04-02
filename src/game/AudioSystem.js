export const AudioSys = {
    ctx: null,
    masterGain: null,
    init: function() {
        try {
            window.AudioContext = window.AudioContext || window.webkitAudioContext;
            this.ctx = new AudioContext();
            this.masterGain = this.ctx.createGain();
            this.masterGain.gain.value = 0.3; // Volume geral reduzido
            this.masterGain.connect(this.ctx.destination);
        } catch(e) { console.log("Áudio não suportado"); }
    },
    playTone: function(freq, type, duration, vol=1, slideFreq=null) {
        if(!this.ctx) return;
        let osc = this.ctx.createOscillator();
        let gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
        if(slideFreq) {
            osc.frequency.exponentialRampToValueAtTime(slideFreq, this.ctx.currentTime + duration);
        }
        gain.gain.setValueAtTime(vol, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);
        
        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start();
        osc.stop(this.ctx.currentTime + duration);
    },
    playNoise: function(duration, vol=1, isDeep=false) {
        if(!this.ctx) return;
        let bufferSize = this.ctx.sampleRate * duration;
        let buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        let data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        let noise = this.ctx.createBufferSource();
        noise.buffer = buffer;
        
        let filter = this.ctx.createBiquadFilter();
        filter.type = isDeep ? 'lowpass' : 'bandpass';
        filter.frequency.value = isDeep ? 400 : 1000;

        let gain = this.ctx.createGain();
        gain.gain.setValueAtTime(vol, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.masterGain);
        noise.start();
    },
    sfx: {
        shoot: () => AudioSys.playTone(800, 'square', 0.1, 0.2, 200),
        eat: () => AudioSys.playTone(150, 'sine', 0.2, 0.4, 300),
        hit: () => AudioSys.playTone(100, 'sawtooth', 0.1, 0.3, 50),
        explosion: () => AudioSys.playNoise(0.5, 0.6, true),
        wormGrowl: () => {
            AudioSys.playTone(60, 'sawtooth', 1.5, 0.8, 30);
            AudioSys.playNoise(1.5, 0.5, true);
        },
        wormhole: () => AudioSys.playTone(400, 'sine', 0.8, 0.5, 1200),
        engine: () => {
            if(Math.random() < 0.2) AudioSys.playNoise(0.1, 0.05, true);
        },
        enemyShoot: () => AudioSys.playTone(600, 'triangle', 0.1, 0.1, 100)
    }
};
