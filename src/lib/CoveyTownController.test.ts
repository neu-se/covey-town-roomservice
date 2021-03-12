import { nanoid } from 'nanoid';
import { mock, mockReset } from 'jest-mock-extended';
import { Socket } from 'socket.io';
import TwilioVideo from './TwilioVideo';
import Player from '../types/Player';
import CoveyTownController from './CoveyTownController';
import CoveyTownListener from '../types/CoveyTownListener';
import { UserLocation } from '../CoveyTypes';
import PlayerSession from '../types/PlayerSession';
import { townSubscriptionHandler } from '../requestHandlers/CoveyTownRequestHandlers';
import CoveyTownsStore from './CoveyTownsStore';
import * as TestUtils from '../TestUtils';
import { ConfigureTest, StartTest } from '../FaultManager';

jest.mock('./TwilioVideo');

const mockGetTokenForTown = jest.fn();
// eslint-disable-next-line
// @ts-ignore it's a mock
TwilioVideo.getInstance = () => ({
  getTokenForTown: mockGetTokenForTown,
});

function generateTestLocation(): UserLocation {
  return {
    rotation: 'back',
    moving: Math.random() < 0.5,
    x: Math.floor(Math.random() * 100),
    y: Math.floor(Math.random() * 100),
  };
}

describe('CoveyTownController', () => {
  beforeEach(() => {
    mockGetTokenForTown.mockClear();
  });
  it.each(ConfigureTest('CRCC'))(
    'constructor should set the friendlyName property [%s]',
    (testConfiguration: string) => {
      // Included in handout
      StartTest(testConfiguration);

      const townName = `FriendlyNameTest-${nanoid()}`;
      const townController = new CoveyTownController(townName, false);
      expect(townController.friendlyName).toBe(townName);
    },
  );
  describe('addPlayer', () => {
    // Included in handout
    it.each(ConfigureTest('CRCAP'))(
      'should use the coveyTownID and player ID properties when requesting a video token [%s]',
      async (testConfiguration: string) => {
        StartTest(testConfiguration);

        const townName = `FriendlyNameTest-${nanoid()}`;
        const townController = new CoveyTownController(townName, false);
        const newPlayerSession = await townController.addPlayer(new Player(nanoid()));
        expect(mockGetTokenForTown).toBeCalledTimes(1);
        expect(mockGetTokenForTown).toBeCalledWith(
          townController.coveyTownID,
          newPlayerSession.player.id,
        );
      },
    );
  });
  describe('town listeners and events', () => {
    let testingTown: CoveyTownController;
    const socketPlayer = new Player('socket player');
    const testSocket = mock<Socket>();
    const mockListeners = [
      mock<CoveyTownListener>(),
      mock<CoveyTownListener>(),
      mock<CoveyTownListener>(),
    ];
    function callHandler(name: string, arg?: UserLocation): boolean {
      let result = false;
      testSocket.on.mock.calls.forEach(a => {
        if (a[0] === name) {
          if (a[1]) {
            a[1](arg);
            result = true;
          }
        }
      });
      return result;
    }
    beforeEach(async () => {
      const townName = `town listeners and events tests ${nanoid()}`;
      testingTown = CoveyTownsStore.getInstance().createTown(townName, false);
      mockReset(testSocket);
      const session = await testingTown.addPlayer(socketPlayer);
      TestUtils.setSessionTokenAndTownID(testingTown.coveyTownID, session.sessionToken, testSocket);
      townSubscriptionHandler(testSocket);
      mockListeners.forEach(mockReset);
    });
    it.each(ConfigureTest('RLEMV'))(
      'should notify added listeners of player movement when updatePlayerLocation is called [%s]',
      async (testConfiguration: string) => {
        StartTest(testConfiguration);

        const player = new Player('test player');
        await testingTown.addPlayer(player);
        const newLocation = generateTestLocation();
        mockListeners.forEach(listener => testingTown.addTownListener(listener));
        expect(callHandler('playerMovement', newLocation)).toBe(true);
        mockListeners.forEach(listener =>
          expect(listener.onPlayerMoved).toBeCalledWith(socketPlayer),
        );
      },
    );
    it.each(ConfigureTest('RLEDC'))(
      'should notify added listeners of player disconnections when destroySession is called [%s]',
      async (testConfiguration: string) => {
        StartTest(testConfiguration);

        const player = new Player('test player');
        const session = await testingTown.addPlayer(player);

        mockListeners.forEach(listener => testingTown.addTownListener(listener));
        expect(callHandler('disconnect')).toBe(true);
        mockListeners.forEach(listener =>
          expect(listener.onPlayerDisconnected).toBeCalledWith(socketPlayer),
        );
      },
    );
    it.each(ConfigureTest('RLENP'))(
      'should notify added listeners of new players when addPlayer is called [%s]',
      async (testConfiguration: string) => {
        StartTest(testConfiguration);

        mockListeners.forEach(listener => testingTown.addTownListener(listener));

        const player = new Player('test player');
        await testingTown.addPlayer(player);
        mockListeners.forEach(listener => expect(listener.onPlayerJoined).toBeCalledWith(player));
      },
    );
    it.each(ConfigureTest('RLEDE'))(
      'should notify added listeners that the town is destroyed when disconnectAllPlayers is called [%s]',
      async (testConfiguration: string) => {
        StartTest(testConfiguration);

        const player = new Player('test player');
        await testingTown.addPlayer(player);

        mockListeners.forEach(listener => testingTown.addTownListener(listener));
        testingTown.disconnectAllPlayers();
        mockListeners.forEach(listener => expect(listener.onTownDestroyed).toBeCalled());
      },
    );
    it.each(ConfigureTest('RLEMVN'))(
      'should not notify removed listeners of player movement when updatePlayerLocation is called [%s]',
      async (testConfiguration: string) => {
        StartTest(testConfiguration);

        const player = new Player('test player');
        await testingTown.addPlayer(player);

        mockListeners.forEach(listener => testingTown.addTownListener(listener));
        const newLocation = generateTestLocation();
        const listenerRemoved = mockListeners[1];
        testingTown.removeTownListener(listenerRemoved);
        expect(callHandler('playerMovement', newLocation)).toBe(true);
        expect(listenerRemoved.onPlayerMoved).not.toBeCalled();
      },
    );
    it.each(ConfigureTest('RLEDCN'))(
      'should not notify removed listeners of player disconnections when destroySession is called [%s]',
      async (testConfiguration: string) => {
        StartTest(testConfiguration);

        const player = new Player('test player');
        const session = await testingTown.addPlayer(player);

        mockListeners.forEach(listener => testingTown.addTownListener(listener));
        const listenerRemoved = mockListeners[1];
        testingTown.removeTownListener(listenerRemoved);
        expect(callHandler('disconnect')).toBe(true);
        expect(listenerRemoved.onPlayerDisconnected).not.toBeCalled();
      },
    );
    it.each(ConfigureTest('RLENPN'))(
      'should not notify removed listeners of new players when addPlayer is called [%s]',
      async (testConfiguration: string) => {
        StartTest(testConfiguration);

        const player = new Player('test player');

        mockListeners.forEach(listener => testingTown.addTownListener(listener));
        const listenerRemoved = mockListeners[1];
        testingTown.removeTownListener(listenerRemoved);
        const session = await testingTown.addPlayer(player);
        expect(callHandler('disconnect')).toBe(true);
        expect(listenerRemoved.onPlayerJoined).not.toBeCalled();
      },
    );

    it.each(ConfigureTest('RLEDEN'))(
      'should not notify removed listeners that the town is destroyed when disconnectAllPlayers is called [%s]',
      async (testConfiguration: string) => {
        StartTest(testConfiguration);

        const player = new Player('test player');
        await testingTown.addPlayer(player);

        mockListeners.forEach(listener => testingTown.addTownListener(listener));
        const listenerRemoved = mockListeners[1];
        testingTown.removeTownListener(listenerRemoved);
        testingTown.disconnectAllPlayers();
        expect(listenerRemoved.onTownDestroyed).not.toBeCalled();
      },
    );
  });
  describe('townSubscriptionHandler', () => {
    const mockSocket = mock<Socket>();
    const otherSocket = mock<Socket>();
    let testingTown: CoveyTownController;
    let player: Player;
    const otherPlayer = new Player('other player');
    let session: PlayerSession;
    function callHandler(name: string, arg?: UserLocation): boolean {
      let result = false;
      otherSocket.on.mock.calls.forEach(a => {
        if (a[0] === name) {
          if (a[1]) {
            a[1](arg);
            result = true;
          }
        }
      });
      return result;
    }
    beforeEach(async () => {
      const townName = `connectPlayerSocket tests ${nanoid()}`;
      testingTown = CoveyTownsStore.getInstance().createTown(townName, false);
      mockReset(mockSocket);
      player = new Player('test player');
      session = await testingTown.addPlayer(player);
      const otherSession = await testingTown.addPlayer(otherPlayer);
      mockReset(otherSocket);
      TestUtils.setSessionTokenAndTownID(
        testingTown.coveyTownID,
        otherSession.sessionToken,
        otherSocket,
      );
      townSubscriptionHandler(otherSocket);
    });
    it.each(ConfigureTest('SUBIDDC'))(
      'should reject connections with invalid town IDs by calling disconnect [%s]',
      async (testConfiguration: string) => {
        StartTest(testConfiguration);

        TestUtils.setSessionTokenAndTownID(nanoid(), session.sessionToken, mockSocket);
        townSubscriptionHandler(mockSocket);
        expect(mockSocket.disconnect).toBeCalledWith(true);
      },
    );
    it.each(ConfigureTest('SUBKTDC'))(
      'should reject connections with invalid session tokens by calling disconnect [%s]',
      async (testConfiguration: string) => {
        StartTest(testConfiguration);

        TestUtils.setSessionTokenAndTownID(testingTown.coveyTownID, nanoid(), mockSocket);
        townSubscriptionHandler(mockSocket);
        expect(mockSocket.disconnect).toBeCalledWith(true);
      },
    );
    describe('with a valid session token', () => {
      beforeEach(() => {});
      it.each(ConfigureTest('SUBNP'))(
        'should add a town listener, which should emit "newPlayer" to the socket when a player joins [%s]',
        async (testConfiguration: string) => {
          StartTest(testConfiguration);

          TestUtils.setSessionTokenAndTownID(
            testingTown.coveyTownID,
            session.sessionToken,
            mockSocket,
          );
          townSubscriptionHandler(mockSocket);
          await testingTown.addPlayer(player);
          expect(mockSocket.emit).toBeCalledWith('newPlayer', player);
        },
      );
      it.each(ConfigureTest('SUBMV'))(
        'should add a town listener, which should emit "playerMoved" to the socket when a player moves [%s]',
        async (testConfiguration: string) => {
          StartTest(testConfiguration);

          TestUtils.setSessionTokenAndTownID(
            testingTown.coveyTownID,
            session.sessionToken,
            mockSocket,
          );
          townSubscriptionHandler(mockSocket);
          expect(callHandler('playerMovement', generateTestLocation())).toBe(true);
          expect(mockSocket.emit).toBeCalledWith('playerMoved', otherPlayer);
        },
      );
      it.each(ConfigureTest('SUBDC'))(
        'should add a town listener, which should emit "playerDisconnect" to the socket when a player disconnects [%s]',
        async (testConfiguration: string) => {
          StartTest(testConfiguration);

          TestUtils.setSessionTokenAndTownID(
            testingTown.coveyTownID,
            session.sessionToken,
            mockSocket,
          );
          townSubscriptionHandler(mockSocket);
          expect(callHandler('disconnect')).toBe(true); // testingTown.destroySession(session);
          expect(mockSocket.emit).toBeCalledWith('playerDisconnect', otherPlayer);
        },
      );
      it.each(ConfigureTest('SUBRC'))(
        'should add a town listener, which should emit "townClosing" to the socket and disconnect it when disconnectAllPlayers is called [%s]',
        async (testConfiguration: string) => {
          StartTest(testConfiguration);

          TestUtils.setSessionTokenAndTownID(
            testingTown.coveyTownID,
            session.sessionToken,
            mockSocket,
          );
          townSubscriptionHandler(mockSocket);
          testingTown.disconnectAllPlayers();
          expect(mockSocket.emit).toBeCalledWith('townClosing');
          expect(mockSocket.disconnect).toBeCalledWith(true);
        },
      );
      describe('when a socket disconnect event is fired', () => {
        it.each(ConfigureTest('SUBDCRL'))(
          'should remove the town listener for that socket, and stop sending events to it [%s]',
          async (testConfiguration: string) => {
            StartTest(testConfiguration);

            TestUtils.setSessionTokenAndTownID(
              testingTown.coveyTownID,
              session.sessionToken,
              mockSocket,
            );
            townSubscriptionHandler(mockSocket);

            // find the 'disconnect' event handler for the socket, which should have been registered after the socket was connected
            const disconnectHandler = mockSocket.on.mock.calls.find(
              call => call[0] === 'disconnect',
            );
            if (disconnectHandler && disconnectHandler[1]) {
              disconnectHandler[1]();
              const newPlayer = new Player('should not be notified');
              await testingTown.addPlayer(newPlayer);
              expect(mockSocket.emit).not.toHaveBeenCalledWith('newPlayer', newPlayer);
            } else {
              fail('No disconnect handler registered');
            }
          },
        );
        it.each(ConfigureTest('SUBDCSE'))(
          'should destroy the session corresponding to that socket [%s]',
          async (testConfiguration: string) => {
            StartTest(testConfiguration);

            TestUtils.setSessionTokenAndTownID(
              testingTown.coveyTownID,
              session.sessionToken,
              mockSocket,
            );
            townSubscriptionHandler(mockSocket);

            // find the 'disconnect' event handler for the socket, which should have been registered after the socket was connected
            const disconnectHandler = mockSocket.on.mock.calls.find(
              call => call[0] === 'disconnect',
            );
            if (disconnectHandler && disconnectHandler[1]) {
              disconnectHandler[1]();
              mockReset(mockSocket);
              TestUtils.setSessionTokenAndTownID(
                testingTown.coveyTownID,
                session.sessionToken,
                mockSocket,
              );
              townSubscriptionHandler(mockSocket);
              expect(mockSocket.disconnect).toHaveBeenCalledWith(true);
            } else {
              fail('No disconnect handler registered');
            }
          },
        );
      });
      it.each(ConfigureTest('SUBMVL'))(
        'should forward playerMovement events from the socket to subscribed listeners [%s]',
        async (testConfiguration: string) => {
          StartTest(testConfiguration);

          TestUtils.setSessionTokenAndTownID(
            testingTown.coveyTownID,
            session.sessionToken,
            mockSocket,
          );
          townSubscriptionHandler(mockSocket);
          const mockListener = mock<CoveyTownListener>();
          testingTown.addTownListener(mockListener);
          // find the 'playerMovement' event handler for the socket, which should have been registered after the socket was connected
          const playerMovementHandler = mockSocket.on.mock.calls.find(
            call => call[0] === 'playerMovement',
          );
          if (playerMovementHandler && playerMovementHandler[1]) {
            const newLocation = generateTestLocation();
            player.location = newLocation;
            playerMovementHandler[1](newLocation);
            expect(mockListener.onPlayerMoved).toHaveBeenCalledWith(player);
          } else {
            fail('No playerMovement handler registered');
          }
        },
      );
    });
  });
});
