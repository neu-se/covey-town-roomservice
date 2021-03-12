import { customAlphabet, nanoid } from 'nanoid';
import { UserLocation } from '../CoveyTypes';
import CoveyTownListener from '../types/CoveyTownListener';
import Player from '../types/Player';
import PlayerSession from '../types/PlayerSession';
import TwilioVideo from './TwilioVideo';
import IVideoClient from './IVideoClient';
import { passwordMatches } from './CoveyTownsStore';
import { Socket } from 'socket.io';

const friendlyNanoID = customAlphabet('1234567890ABCDEF', 8);

/**
 * The CoveyTownController implements the logic for each town: managing the various events that
 * can occur (e.g. joining a town, moving, leaving a town)
 */
export default class CoveyTownController {
  set isPubliclyListed(value: boolean) {
    this._isPubliclyListed = value;
  }

  get isPubliclyListed(): boolean {
    return this._isPubliclyListed;
  }

  get townUpdatePassword(): string {
    return this._townUpdatePassword;
  }

  get players(): Player[] {
    return this._players;
  }

  get occupancy(): number {
    return this._listeners.length;
  }

  get friendlyName(): string {
    return this._friendlyName;
  }

  set friendlyName(value: string) {
    this._friendlyName = value;
  }

  get coveyTownID(): string {
    return this._coveyTownID;
  }

  /** The list of players currently in the town * */
  private _players: Player[] = [];

  /** The list of valid sessions for this town * */
  private _sessions: PlayerSession[] = [];

  /** The videoClient that this CoveyTown will use to provision video resources * */
  private _videoClient: IVideoClient = TwilioVideo.getInstance();

  /** The list of CoveyTownListeners that are subscribed to events in this town * */
  private _listeners: CoveyTownListener[] = [];

  private readonly _coveyTownID: string;

  private _friendlyName: string;

  private readonly _townUpdatePassword: string;

  private _isPubliclyListed: boolean;

  constructor(friendlyName: string, isPubliclyListed: boolean) {
    this._coveyTownID = friendlyNanoID();
    this._townUpdatePassword = nanoid(24);
    this._isPubliclyListed = isPubliclyListed;
    this._friendlyName = friendlyName;
  }

  /**
   * Adds a player to this Covey Town, provisioning the necessary credentials for the
   * player, and returning them
   *
   * @param newPlayer The new player to add to the town
   */
  async addPlayer(newPlayer: Player): Promise<PlayerSession> {
    const theSession = new PlayerSession(newPlayer);

    this._sessions.push(theSession);
    this._players.push(newPlayer);

    // Create a video token for this user to join this town
    theSession.videoToken = await this._videoClient.getTokenForTown(
      this._coveyTownID,
      newPlayer.id,
    );

    // Notify other players that this player has joined
    this._listeners.forEach(listener => listener.onPlayerJoined(newPlayer));

    return theSession;
  }

  update(
    coveyTownPassword: string,
    friendlyName: string | undefined,
    makePublic: boolean | undefined,
  ) {
    let result = false;
    if (passwordMatches(coveyTownPassword, this.townUpdatePassword)) {
      result = true;
      if (friendlyName !== undefined) {
        if (friendlyName.length === 0) {
          result = false;
        } else {
          this.friendlyName = friendlyName;
        }
      }
      if (result && makePublic !== undefined) {
        this.isPubliclyListed = makePublic;
      }
    }
    return result;
  }

  /**
   * Updates the location of a player within the town
   * @param player Player to update location for
   * @param location New location for this player
   */
  private onPlayerMovement(player: Player, location: UserLocation): void {
    player.updateLocation(location);
    this._listeners.forEach(listener => listener.onPlayerMoved(player));
  }

  /**
   * Subscribe to events from this town. Callers should make sure to
   * unsubscribe when they no longer want those events by calling removeTownListener
   *
   * @param listener New listener
   */
  addTownListener(listener: CoveyTownListener): void {
    this._listeners.push(listener);
  }

  /**
   * Unsubscribe from events in this town.
   *
   * @param listener The listener to unsubscribe, must be a listener that was registered
   * with addTownListener, or otherwise will be a no-op
   */
  removeTownListener(listener: CoveyTownListener): void {
    this._listeners = this._listeners.filter(v => v !== listener);
  }

  disconnectAllPlayers(): void {
    this._listeners.forEach(listener => listener.onTownDestroyed());
  }

  connect(sessionToken: string, socket: Socket) {
    const session = this._sessions.find(p => p.sessionToken === sessionToken);
    if (!session) {
      // No valid session exists for this token, hence this client's connection should be terminated
      socket.disconnect(true);
    } else {
      // Create an adapter that will translate events from the CoveyTownController into
      // events that the socket protocol knows about
      const listener = townSocketAdapter(socket);
      this.addTownListener(listener);

      // Register an event listener for the client socket: if the client disconnects,
      // clean up our listener adapter, and then let the CoveyTownController know that the
      // player's session is disconnected
      socket.on('disconnect', () => {
        this.onDisconnect(listener, session);
      });

      // Register an event listener for the client socket: if the client updates their
      // location, inform the CoveyTownController
      socket.on('playerMovement', (movementData: UserLocation) => {
        this.onPlayerMovement(session.player, movementData);
      });
    }
  }

  private onDisconnect(listener: CoveyTownListener, session: PlayerSession) {
    this.removeTownListener(listener);
    this._players = this._players.filter(p => p.id !== session.player.id);
    this._sessions = this._sessions.filter(s => s.sessionToken !== session.sessionToken);
    this._listeners.forEach(listener => listener.onPlayerDisconnected(session.player));
  }
}

/**
 * An adapter between CoveyTownController's event interface (CoveyTownListener)
 * and the low-level network communication protocol
 *
 * @param socket the Socket object that we will use to communicate with the player
 */
function townSocketAdapter(socket: Socket): CoveyTownListener {
  return {
    onPlayerMoved(movedPlayer: Player) {
      socket.emit('playerMoved', movedPlayer);
    },
    onPlayerDisconnected(removedPlayer: Player) {
      socket.emit('playerDisconnect', removedPlayer);
    },
    onPlayerJoined(newPlayer: Player) {
      socket.emit('newPlayer', newPlayer);
    },
    onTownDestroyed() {
      socket.emit('townClosing');
      socket.disconnect(true);
    },
  };
}
