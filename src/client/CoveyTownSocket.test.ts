import Express from 'express';
import CORS from 'cors';
import http from 'http';
import {nanoid} from 'nanoid';
import {AddressInfo} from 'net';
import {promisify} from 'util';
import * as TestUtils from '../TestUtils';

import addTownRoutes from '../router/towns';
import TownServiceClient from './TownsServiceClient';
import {UserLocation} from '../CoveyTypes';
import {ConfigureTest, StartTest} from '../FaultManager';

const sleep = promisify(setTimeout);

type TestTownData = {
  friendlyName: string, coveyTownID: string,
  isPubliclyListed: boolean, roomUpdatePassword: string
};

describe('TownServiceApiSocket', () => {
  let server: http.Server;
  let apiClient: TownServiceClient;

  async function createTownForTesting(friendlyNameToUse?: string, isPublic = false): Promise<TestTownData> {
    const friendlyName = friendlyNameToUse !== undefined ? friendlyNameToUse :
      `${isPublic ? 'Public' : 'Private'}TestingTown=${nanoid()}`;
    const ret = await apiClient.createTown({
      friendlyName,
      isPubliclyListed: isPublic,
    });
    return {
      friendlyName,
      isPubliclyListed: isPublic,
      coveyTownID: ret.coveyTownID,
      roomUpdatePassword: ret.coveyTownPassword,
    };
  }

  beforeAll(async () => {
    const app = Express();
    app.use(CORS());
    server = http.createServer(app);

    addTownRoutes(server, app);
    await server.listen();
    const address = server.address() as AddressInfo;

    apiClient = new TownServiceClient(`http://127.0.0.1:${address.port}`);
  });
  afterAll(async () => {
    await server.close();
  });
  afterEach(() => {
    TestUtils.cleanupSockets();
  });
  it.each(ConfigureTest('CRSID'))('Rejects invalid CoveyTownIDs, even if otherwise valid session token [%s]', async (testConfiguration: string) => {
    StartTest(testConfiguration);

    const room = await createTownForTesting();
    const joinData = await apiClient.joinTown({coveyTownID: room.coveyTownID, userName: nanoid()});
    const {socketDisconnected} = TestUtils.createSocketClient(server, joinData.coveySessionToken, nanoid());
    await socketDisconnected;
  });
  it.each(ConfigureTest('CRSST'))('Rejects invalid session tokens, even if otherwise valid room id [%s]', async (testConfiguration: string) => {
    StartTest(testConfiguration);

    const room = await createTownForTesting();
    await apiClient.joinTown({coveyTownID: room.coveyTownID, userName: nanoid()});
    const {socketDisconnected} = TestUtils.createSocketClient(server, nanoid(), room.coveyTownID);
    await socketDisconnected;
  });
  it.each(ConfigureTest('CRSMU'))('Dispatches movement updates to all clients in the same room [%s]', async (testConfiguration: string) => {
    StartTest(testConfiguration);
    const room = await createTownForTesting();
    const joinData = await apiClient.joinTown({coveyTownID: room.coveyTownID, userName: nanoid()});
    const joinData2 = await apiClient.joinTown({coveyTownID: room.coveyTownID, userName: nanoid()});
    const joinData3 = await apiClient.joinTown({coveyTownID: room.coveyTownID, userName: nanoid()});
    const socketSender = TestUtils.createSocketClient(server, joinData.coveySessionToken, room.coveyTownID).socket;
    const {playerMoved} = TestUtils.createSocketClient(server, joinData2.coveySessionToken, room.coveyTownID);
    const {playerMoved: playerMoved2} = TestUtils.createSocketClient(server, joinData3.coveySessionToken, room.coveyTownID);
    const newLocation: UserLocation = {x: 100, y: 100, moving: true, rotation: 'back'};
    socketSender.emit('playerMovement', newLocation);
    const [movedPlayer, otherMovedPlayer]= await Promise.all([playerMoved, playerMoved2]);
    expect(movedPlayer.location).toMatchObject(newLocation);
    expect(otherMovedPlayer.location).toMatchObject(newLocation);
  });
  it.each(ConfigureTest('CRSDC'))('Invalidates the user session after disconnection [%s]', async (testConfiguration: string) => {
    StartTest(testConfiguration);

    // This test will timeout if it fails - it will never reach the expectation
    const room = await createTownForTesting();
    const joinData = await apiClient.joinTown({coveyTownID: room.coveyTownID, userName: nanoid()});
    const {socket, socketConnected} = TestUtils.createSocketClient(server, joinData.coveySessionToken, room.coveyTownID);
    await socketConnected;
    socket.close();
    const {socket: secondTryWithSameToken, socketDisconnected: secondSocketDisconnected} = TestUtils.createSocketClient(server, joinData.coveySessionToken, room.coveyTownID);
    await secondSocketDisconnected;
    expect(secondTryWithSameToken.disconnected).toBe(true);
  });
  it.each(ConfigureTest('CRSNP'))('Informs all new players when a player joins [%s]', async (testConfiguration: string) => {
    StartTest(testConfiguration);

    const room = await createTownForTesting();
    const joinData = await apiClient.joinTown({coveyTownID: room.coveyTownID, userName: nanoid()});
    const joinData2 = await apiClient.joinTown({coveyTownID: room.coveyTownID, userName: nanoid()});
    const {socketConnected, newPlayerJoined} = TestUtils.createSocketClient(server, joinData.coveySessionToken, room.coveyTownID);
    const {
      socketConnected: connectPromise2,
      newPlayerJoined: newPlayerPromise2,
    } = TestUtils.createSocketClient(server, joinData2.coveySessionToken, room.coveyTownID);
    await Promise.all([socketConnected, connectPromise2]);
    const newJoinerName = nanoid();

    await apiClient.joinTown({coveyTownID: room.coveyTownID, userName: newJoinerName});
    expect((await newPlayerJoined)._userName).toBe(newJoinerName);
    expect((await newPlayerPromise2)._userName).toBe(newJoinerName);

  });
  it.each(ConfigureTest('CRSDCN'))('Informs all players when a player disconnects [%s]', async (testConfiguration: string) => {
    StartTest(testConfiguration);

    const room = await createTownForTesting();
    const joinData = await apiClient.joinTown({coveyTownID: room.coveyTownID, userName: nanoid()});
    const joinData2 = await apiClient.joinTown({coveyTownID: room.coveyTownID, userName: nanoid()});
    const userWhoLeaves = nanoid();
    const joinDataWhoLeaves = await apiClient.joinTown({coveyTownID: room.coveyTownID, userName: userWhoLeaves});
    const {socketConnected, playerDisconnected} = TestUtils.createSocketClient(server, joinData.coveySessionToken, room.coveyTownID);
    const {socketConnected: connectPromise2, playerDisconnected: playerDisconnectPromise2} = TestUtils.createSocketClient(server, joinData2.coveySessionToken, room.coveyTownID);
    const {socket: socketWhoLeaves, socketConnected: connectPromise3} = TestUtils.createSocketClient(server, joinDataWhoLeaves.coveySessionToken, room.coveyTownID);
    await Promise.all([socketConnected, connectPromise2, connectPromise3]);
    socketWhoLeaves.close();
    expect((await playerDisconnected)._userName).toBe(userWhoLeaves);
    expect((await playerDisconnectPromise2)._userName).toBe(userWhoLeaves);

  });
  it.each(ConfigureTest('CRSDCDX'))('Informs all players when the room is destroyed [%s]', async (testConfiguration: string) => {
    StartTest(testConfiguration);

    const room = await createTownForTesting();
    const joinData = await apiClient.joinTown({coveyTownID: room.coveyTownID, userName: nanoid()});
    const joinData2 = await apiClient.joinTown({coveyTownID: room.coveyTownID, userName: nanoid()});
    const {socketDisconnected, socketConnected} = TestUtils.createSocketClient(server, joinData.coveySessionToken, room.coveyTownID);
    const {socketDisconnected: disconnectPromise2, socketConnected: connectPromise2} = TestUtils.createSocketClient(server, joinData2.coveySessionToken, room.coveyTownID);
    await Promise.all([socketConnected, connectPromise2]);
    await apiClient.deleteTown({coveyTownID: room.coveyTownID, coveyTownPassword: room.roomUpdatePassword});
    await Promise.all([socketDisconnected, disconnectPromise2]);
  });
});
