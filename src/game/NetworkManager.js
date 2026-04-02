import Peer from 'peerjs';

class NetworkManager {
  constructor() {
    this.peer = null;
    this.connections = []; // For the Host to manage multiple clients
    this.hostConnection = null; // For the Client to manage connection to Host
    this.isHost = false;
    this.events = {
      onConnect: () => { },
      onData: () => { },
      onDisconnect: () => { },
      onError: () => { }
    };
  }

  setCallbacks({ onConnect, onData, onDisconnect, onError }) {
    if (onConnect) this.events.onConnect = onConnect;
    if (onData) this.events.onData = onData;
    if (onDisconnect) this.events.onDisconnect = onDisconnect;
    if (onError) this.events.onError = onError;
  }

  hostGame(id, onReady) {
    this.isHost = true;
    this.peer = new Peer(id); // Use specific ID for global room

    this.peer.on('open', (assignedId) => {
      onReady(assignedId);
    });

    this.peer.on('connection', (conn) => {
      this.connections.push(conn);
      this.setupHostConnection(conn);
    });

    this.peer.on('error', (err) => {
      if (err.type === 'unavailable-id') {
        // ID is taken! That means the global room exists. We should join it instead.
        this.events.onError({ type: 'taken' });
      } else {
        console.error('PeerJS Error:', err);
        this.events.onError(err);
      }
    });
  }

  joinGame(hostId) {
    this.isHost = false;
    this.peer = new Peer();

    this.peer.on('open', () => {
      this.hostConnection = this.peer.connect(hostId, { reliable: true });
      this.setupClientConnection(this.hostConnection);
    });

    this.peer.on('error', (err) => {
      console.error('PeerJS Error:', err);
      this.events.onError(err);
    });
  }

  setupHostConnection(conn) {
    conn.on('open', () => {
      // We can broadcast that a new player joined
    });

    conn.on('data', (data) => {
      this.events.onData(data, conn.peer); // Pass peer ID to identify who sent it
    });

    conn.on('close', () => {
      this.connections = this.connections.filter(c => c !== conn);
      this.events.onDisconnect(conn.peer);
    });

    conn.on('error', (err) => {
      console.error('Host Connection Error:', err);
    });
  }

  setupClientConnection(conn) {
    conn.on('open', () => {
      this.events.onConnect();
    });

    conn.on('data', (data) => {
      this.events.onData(data);
    });

    conn.on('close', () => {
      this.hostConnection = null;
      this.events.onDisconnect('host');
    });

    conn.on('error', (err) => {
      console.error('Client Connection Error:', err);
      this.events.onError(err);
    });
  }

  send(data) {
    if (this.isHost) {
      // Host broadcasts to all clients
      this.connections.forEach(conn => {
        if (conn.open) conn.send(data);
      });
    } else {
      // Client sends to Host
      if (this.hostConnection && this.hostConnection.open) {
        this.hostConnection.send(data);
      }
    }
  }

  disconnect() {
    this.connections.forEach(c => c.close());
    this.connections = [];
    if (this.hostConnection) {
      this.hostConnection.close();
      this.hostConnection = null;
    }
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
  }
}

export const networkManager = new NetworkManager();
