import Express from 'express';
import CORS from 'cors';
import http from 'http';
import {nanoid} from 'nanoid';
import assert from 'assert';
import {AddressInfo} from 'net';

import addTownRoutes from '../router/towns';
import {TownListResponse} from '../requestHandlers/CoveyTownRequestHandlers';
import TownServiceClient from './TownsServiceClient';
import {ConfigureTest, StartTest} from '../FaultManager';

type TestTownData = {
  friendlyName: string, coveyTownID: string,
  isPubliclyListed: boolean, TownUpdatePassword: string
};

function expectTownListMatches(Towns: TownListResponse, Town: TestTownData) {
  const matching = Towns.towns.find(rownInfo => rownInfo.coveyTownID === Town.coveyTownID);
  if (Town.isPubliclyListed) {
    expect(matching)
      .toBeDefined();
    assert(matching);
    expect(matching.friendlyName)
      .toBe(Town.friendlyName);
  } else {
    expect(matching)
      .toBeUndefined();
  }
}

describe('TownServiceAPIREST', () => {
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
      TownUpdatePassword: ret.coveyTownPassword,
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
  describe('CoveyTownCreateAPI', () => {
    it.each(ConfigureTest('CR'))('Allows for multiple towns with the same friendlyName [%s]', async (testConfiguration: string) => {
      StartTest(testConfiguration);

      const firstTown = await createTownForTesting();
      const secondTown = await createTownForTesting(firstTown.friendlyName);
      expect(firstTown.coveyTownID)
        .not
        .toBe(secondTown.coveyTownID);
    });
    it.each(ConfigureTest('CR2'))('Prohibits a blank friendlyName [%s]', async (testConfiguration: string) => {
      StartTest(testConfiguration);

      try {
        await createTownForTesting('');
        fail('createTown should throw an error if friendly name is empty string');
      } catch (err) {
        // OK
      }
    });
  });

  describe('CoveyTownListAPI', () => {
    it.each(ConfigureTest('LPub'))('Lists public Towns, but not private towns [%s]', async (testConfiguration: string) => {
      StartTest(testConfiguration);

      const pubTown1 = await createTownForTesting(undefined, true);
      const privTown1 = await createTownForTesting(undefined, false);
      const pubTown2 = await createTownForTesting(undefined, true);
      const privTown2 = await createTownForTesting(undefined, false);

      const towns = await apiClient.listTowns();
      expectTownListMatches(towns, pubTown1);
      expectTownListMatches(towns, pubTown2);
      expectTownListMatches(towns, privTown1);
      expectTownListMatches(towns, privTown2);

    });
    it.each(ConfigureTest('LMF'))('Allows for multiple towns with the same friendlyName [%s]', async (testConfiguration: string) => {
      StartTest(testConfiguration);

      const pubTown1 = await createTownForTesting(undefined, true);
      const privTown1 = await createTownForTesting(pubTown1.friendlyName, false);
      const pubTown2 = await createTownForTesting(pubTown1.friendlyName, true);
      const privTown2 = await createTownForTesting(pubTown1.friendlyName, false);

      const towns = await apiClient.listTowns();
      expectTownListMatches(towns, pubTown1);
      expectTownListMatches(towns, pubTown2);
      expectTownListMatches(towns, privTown1);
      expectTownListMatches(towns, privTown2);
    });
  });

  describe('CoveyTownDeleteAPI', () => {
    it.each(ConfigureTest('DRP'))('Throws an error if the password is invalid [%s]', async (testConfiguration: string) => {
      StartTest(testConfiguration);

      const {coveyTownID} = await createTownForTesting(undefined, true);
      try {
        await apiClient.deleteTown({coveyTownID, coveyTownPassword: nanoid()});
        fail('Expected deleteTown to throw an error');
      } catch (e) {
        // Expected error
      }
    });
    it.each(ConfigureTest('DRID'))('Throws an error if the TownID is invalid [%s]', async (testConfiguration: string) => {
      StartTest(testConfiguration);

      const {TownUpdatePassword} = await createTownForTesting(undefined, true);
      try {
        await apiClient.deleteTown({coveyTownID: nanoid(), coveyTownPassword: TownUpdatePassword});
        fail('Expected deleteTown to throw an error');
      } catch (e) {
        // Expected error
      }
    });
    it.each(ConfigureTest('DRV'))('Deletes a Town if given a valid password and Town, no longer allowing it to be joined or listed [%s]', async (testConfiguration: string) => {
      StartTest(testConfiguration);

      const {coveyTownID, TownUpdatePassword} = await createTownForTesting(undefined, true);
      await apiClient.deleteTown({coveyTownID, coveyTownPassword: TownUpdatePassword});
      try {
        await apiClient.joinTown({userName: nanoid(), coveyTownID});
        fail('Expected joinTown to throw an error');
      } catch (e) {
        // Expected
      }
      const listedTowns = await apiClient.listTowns();
      if (listedTowns.towns.find(r => r.coveyTownID === coveyTownID)) {
        fail('Expected the deleted Town to no longer be listed');
      }
    });
  });
  describe('CoveyTownUpdateAPI', () => {
    it.each(ConfigureTest('CPU'))('Checks the password before updating any values [%s]', async (testConfiguration: string) => {
      StartTest(testConfiguration);

      const pubTown1 = await createTownForTesting(undefined, true);
      expectTownListMatches(await apiClient.listTowns(), pubTown1);
      try {
        await apiClient.updateTown({
          coveyTownID: pubTown1.coveyTownID,
          coveyTownPassword: `${pubTown1.TownUpdatePassword}*`,
          friendlyName: 'broken',
          isPubliclyListed: false,
        });
        fail('updateTown with an invalid password should throw an error');
      } catch (err) {
        // err expected
        // TODO this should really check to make sure it's the *right* error, but we didn't specify the format of the exception :(
      }

      // Make sure name or vis didn't change
      expectTownListMatches(await apiClient.listTowns(), pubTown1);
    });
    it.each(ConfigureTest('UFV'))('Updates the friendlyName and visbility as requested [%s]', async (testConfiguration: string) => {
      StartTest(testConfiguration);

      const pubTown1 = await createTownForTesting(undefined, false);
      expectTownListMatches(await apiClient.listTowns(), pubTown1);
      await apiClient.updateTown({
        coveyTownID: pubTown1.coveyTownID,
        coveyTownPassword: pubTown1.TownUpdatePassword,
        friendlyName: 'newName',
        isPubliclyListed: true,
      });
      pubTown1.friendlyName = 'newName';
      pubTown1.isPubliclyListed = true;
      expectTownListMatches(await apiClient.listTowns(), pubTown1);
    });
    it.each(ConfigureTest('UFVU'))('Does not update the visibility if visibility is undefined [%s]', async (testConfiguration: string) => {
      StartTest(testConfiguration);

      const pubTown1 = await createTownForTesting(undefined, true);
      expectTownListMatches(await apiClient.listTowns(), pubTown1);
      await apiClient.updateTown({
        coveyTownID: pubTown1.coveyTownID,
        coveyTownPassword: pubTown1.TownUpdatePassword,
        friendlyName: 'newName2',
      });
      pubTown1.friendlyName = 'newName2';
      expectTownListMatches(await apiClient.listTowns(), pubTown1);
    });
  });

  describe('CoveyMemberAPI', () => {
    it.each(ConfigureTest('MNSR'))('Throws an error if the Town does not exist [%s]', async (testConfiguration: string) => {
      StartTest(testConfiguration);

      await createTownForTesting(undefined, true);
      try {
        await apiClient.joinTown({
          userName: nanoid(),
          coveyTownID: nanoid(),
        });
        fail('Expected an error to be thrown by joinTown but none thrown');
      } catch (err) {
        // OK, expected an error
        // TODO this should really check to make sure it's the *right* error, but we didn't specify the format of the exception :(
      }
    });
    it.each(ConfigureTest('MJPP'))('Admits a user to a valid public or private Town [%s]', async (testConfiguration: string) => {
      StartTest(testConfiguration);

      const pubTown1 = await createTownForTesting(undefined, true);
      const privTown1 = await createTownForTesting(undefined, false);
      const res = await apiClient.joinTown({
        userName: nanoid(),
        coveyTownID: pubTown1.coveyTownID,
      });
      expect(res.coveySessionToken)
        .toBeDefined();
      expect(res.coveyUserID)
        .toBeDefined();

      const res2 = await apiClient.joinTown({
        userName: nanoid(),
        coveyTownID: privTown1.coveyTownID,
      });
      expect(res2.coveySessionToken)
        .toBeDefined();
      expect(res2.coveyUserID)
        .toBeDefined();

    });
  });
});
