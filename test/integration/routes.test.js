/* eslint-disable */
const createJWKSMock = require('mock-jwks').default
const { describe, test, before } = require('mocha')
const { expect } = require('chai')
const nock = require('nock')

const { createHttpServer } = require('../../app/server')
const {
  healthCheck,
  getAuthTokenRoute,
  postRunProcess,
  postRunProcessNoFileAttach,
  getItemRoute,
  getItemMetadataRoute,
  getItemMetadataRouteLegacy,
  getLastTokenIdRoute,
  addFileRoute,
  addFileRouteLegacy,
} = require('../helper/routeHelper')
const USER_ALICE_TOKEN = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY'
const USER_BOB_TOKEN = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty'
const { assertItem } = require('../helper/appHelper')
const { runProcess, utf8ToUint8Array } = require('../../app/util/appUtil')
const {
  AUTH_TOKEN_URL,
  AUTH_ISSUER,
  AUTH_AUDIENCE,
  LEGACY_METADATA_KEY,
  METADATA_KEY_LENGTH,
  METADATA_VALUE_LITERAL_LENGTH,
  MAX_METADATA_COUNT,
} = require('../../app/env')

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const bs58 = require('base-x')(BASE58)

describe('routes', function () {
  before(async () => {
    nock.disableNetConnect()
    nock.enableNetConnect((host) => host.includes('127.0.0.1') || host.includes('localhost'))
  })

  afterEach(() => {
    nock.abortPendingRequests()
    nock.cleanAll()
  })

  describe('health check', function () {
    let app

    before(async function () {
      app = await createHttpServer()
    })

    test('health check', async function () {
      const expectedResult = { status: 'ok' }

      const actualResult = await healthCheck(app)
      expect(actualResult.status).to.equal(200)
      expect(actualResult.body).to.deep.equal(expectedResult)
    })
  })

  describe('access token', async () => {
    // Inputs
    let app
    const tokenResponse = {
      data: {
        access_token: 'fake access token',
        expires_in: 86400,
        token_type: 'Bearer',
      },
    }

    before(async () => {
      app = await createHttpServer()
      nock(AUTH_TOKEN_URL).post('/').reply(200, tokenResponse)
    })

    test('get access token', async () => {
      // Execution
      const res = await getAuthTokenRoute(app)

      // Assertions
      expect(res.error).to.be.false
      expect(res.status).to.equal(200)
      expect(res.body).to.deep.equal(tokenResponse)
    })
  })

  describe('invalid credentials', async () => {
    // Inputs
    let app
    const deniedResponse = {
      data: {
        error: 'access_denied',
        error_description: 'Unauthorized',
      },
    }

    before(async () => {
      app = await createHttpServer()
      nock(AUTH_TOKEN_URL).post('/').reply(401, deniedResponse)
    })

    test('access denied to token', async () => {
      const res = await getAuthTokenRoute(app)

      expect(res.error).to.exist
      expect(res.status).to.equal(401)
      expect(res.body).to.deep.equal(deniedResponse)
    })

    test('invalid token', async function () {
      const result = await getLastTokenIdRoute(app, 'invalidToken')
      expect(result.status).to.equal(401)
    })
  })

  describe('authenticated routes', function () {
    let app
    let jwksMock
    let authToken

    before(async function () {
      app = await createHttpServer()

      jwksMock = createJWKSMock(AUTH_ISSUER)
      jwksMock.start()
      authToken = jwksMock.token({
        aud: AUTH_AUDIENCE,
        iss: AUTH_ISSUER,
      })
    })

    after(async function () {
      await jwksMock.stop()
    })

    test('add and get item - single metadataFile (legacy)', async function () {
      const outputs = [{ owner: USER_ALICE_TOKEN, metadataFile: './test/data/test_file_01.txt' }]
      const runProcessResult = await postRunProcess(app, authToken, [], outputs)
      expect(runProcessResult.body).to.have.length(1)
      expect(runProcessResult.status).to.equal(200)

      const lastToken = await getLastTokenIdRoute(app, authToken)
      expect(lastToken.body).to.have.property('id')

      const getItemResult = await getItemRoute(app, authToken, lastToken.body)
      expect(getItemResult.status).to.equal(200)
      expect(getItemResult.body.id).to.deep.equal(lastToken.body.id)
      expect(getItemResult.body.metadata).to.deep.equal([LEGACY_METADATA_KEY])
    })

    test('add and get item - single metadata FILE', async function () {
      const outputs = [
        { owner: USER_ALICE_TOKEN, metadata: { testFile: { type: 'FILE', value: './test/data/test_file_01.txt' } } },
      ]
      const runProcessResult = await postRunProcess(app, authToken, [], outputs)
      expect(runProcessResult.body).to.have.length(1)
      expect(runProcessResult.status).to.equal(200)
      const lastToken = await getLastTokenIdRoute(app, authToken)
      expect(lastToken.body).to.have.property('id')

      const getItemResult = await getItemRoute(app, authToken, lastToken.body)
      expect(getItemResult.status).to.equal(200)
      expect(getItemResult.body.id).to.deep.equal(lastToken.body.id)
      expect(getItemResult.body.metadata).to.deep.equal(['testFile'])
    })

    test('add and get item - single metadata LITERAL', async function () {
      const outputs = [{ owner: USER_ALICE_TOKEN, metadata: { testLiteral: { type: 'LITERAL', value: 'notAFile' } } }]
      const runProcessResult = await postRunProcess(app, authToken, [], outputs)
      expect(runProcessResult.body).to.have.length(1)
      expect(runProcessResult.status).to.equal(200)

      const lastToken = await getLastTokenIdRoute(app, authToken)
      expect(lastToken.body).to.have.property('id')

      const getItemResult = await getItemRoute(app, authToken, lastToken.body)
      expect(getItemResult.status).to.equal(200)
      expect(getItemResult.body.id).to.deep.equal(lastToken.body.id)
      expect(getItemResult.body.metadata).to.deep.equal(['testLiteral'])
    })

    test('add and get item - single NONE', async function () {
      const outputs = [{ owner: USER_ALICE_TOKEN, metadata: { testNone: { type: 'NONE' } } }]
      const runProcessResult = await postRunProcess(app, authToken, [], outputs)
      expect(runProcessResult.body).to.have.length(1)
      expect(runProcessResult.status).to.equal(200)
      const lastToken = await getLastTokenIdRoute(app, authToken)
      expect(lastToken.body).to.have.property('id')
      const getItemResult = await getItemRoute(app, authToken, lastToken.body)
      expect(getItemResult.status).to.equal(200)
      expect(getItemResult.body.id).to.deep.equal(lastToken.body.id)
      expect(getItemResult.body.metadata).to.deep.equal(['testNone'])
    })

    test('add and get item metadata - FILE + LITERAL + NONE', async function () {
      const outputs = [
        {
          owner: USER_ALICE_TOKEN,
          metadata: {
            testFile: { type: 'FILE', value: './test/data/test_file_01.txt' },
            testLiteral: { type: 'LITERAL', value: 'notAFile' },
            testNone: { type: 'NONE' },
          },
        },
      ]
      const runProcessResult = await postRunProcess(app, authToken, [], outputs)
      expect(runProcessResult.body).to.have.length(1)
      expect(runProcessResult.status).to.equal(200)

      const lastToken = await getLastTokenIdRoute(app, authToken)
      expect(lastToken.body).to.have.property('id')

      const getItemResult = await getItemRoute(app, authToken, lastToken.body)
      expect(getItemResult.status).to.equal(200)
      expect(getItemResult.body.id).to.deep.equal(lastToken.body.id)
      expect(getItemResult.body.metadata).to.deep.equal(['testFile', 'testLiteral', 'testNone'])

      const testFile = await getItemMetadataRoute(app, authToken, {
        id: lastToken.body.id,
        metadataKey: 'testFile',
      })
      expect(testFile.text.toString()).equal('This is the first test file...\n')
      expect(testFile.header['content-disposition']).equal('attachment; filename="test_file_01.txt"')

      const testLiteral = await getItemMetadataRoute(app, authToken, {
        id: lastToken.body.id,
        metadataKey: 'testLiteral',
      })

      expect(testLiteral.text).equal('notAFile')
      expect(testLiteral.header['content-type']).equal('text/plain; charset=utf-8')

      const testNone = await getItemMetadataRoute(app, authToken, {
        id: lastToken.body.id,
        metadataKey: 'testNone',
      })

      expect(testNone.text).to.deep.equal('')
      expect(testNone.header['content-type']).equal('text/plain; charset=utf-8')
    })

    test('add and get item - multiple FILE', async function () {
      const outputs = [
        {
          owner: USER_ALICE_TOKEN,
          metadata: {
            testFile1: { type: 'FILE', value: './test/data/test_file_01.txt' },
            testFile2: { type: 'FILE', value: './test/data/test_file_02.txt' },
          },
        },
      ]
      const runProcessResult = await postRunProcess(app, authToken, [], outputs)
      expect(runProcessResult.body).to.have.length(1)
      expect(runProcessResult.status).to.equal(200)

      const lastToken = await getLastTokenIdRoute(app, authToken)
      expect(lastToken.body).to.have.property('id')

      const getItemResult = await getItemRoute(app, authToken, lastToken.body)
      expect(getItemResult.status).to.equal(200)
      expect(getItemResult.body.id).to.deep.equal(lastToken.body.id)
      expect(getItemResult.body.metadata).to.deep.equal(['testFile1', 'testFile2'])
    })

    test('add and get item - multiple LITERAL', async function () {
      const outputs = [
        {
          owner: USER_ALICE_TOKEN,
          metadata: {
            testLiteral1: { type: 'LITERAL', value: 'test1' },
            testLiteral2: { type: 'LITERAL', value: 'test2' },
          },
        },
      ]
      const runProcessResult = await postRunProcess(app, authToken, [], outputs)
      expect(runProcessResult.body).to.have.length(1)
      expect(runProcessResult.status).to.equal(200)

      const lastToken = await getLastTokenIdRoute(app, authToken)
      expect(lastToken.body).to.have.property('id')

      const getItemResult = await getItemRoute(app, authToken, lastToken.body)
      expect(getItemResult.status).to.equal(200)
      expect(getItemResult.body.id).to.deep.equal(lastToken.body.id)
      expect(getItemResult.body.metadata).to.deep.equal(['testLiteral1', 'testLiteral2'])
    })

    test('add item - missing FILE attachments', async function () {
      const outputs = [
        { owner: USER_ALICE_TOKEN, metadata: { testFile1: { type: 'FILE', value: './test/data/test_file_01.txt' } } },
      ]

      const runProcessResult = await postRunProcessNoFileAttach(app, authToken, [], outputs)
      expect(runProcessResult.body.message).to.contain('no attached file')
      expect(runProcessResult.status).to.equal(400)
    })

    test('add item - metadataKey too long', async function () {
      const metadataKey = 'a'.repeat(METADATA_KEY_LENGTH + 1)
      const outputs = [{ owner: USER_ALICE_TOKEN, metadata: { [metadataKey]: { type: 'LITERAL', value: 'test' } } }]
      const runProcessResult = await postRunProcess(app, authToken, [], outputs)
      expect(runProcessResult.body.message).to.contain('too long')
      expect(runProcessResult.status).to.equal(400)
    })

    test('add item - metadataKey too long (multibyte character)', async function () {
      const metadataKey = '£'.repeat(METADATA_KEY_LENGTH / 2 + 1)
      const outputs = [{ owner: USER_ALICE_TOKEN, metadata: { [metadataKey]: { type: 'LITERAL', value: 'test' } } }]
      const runProcessResult = await postRunProcess(app, authToken, [], outputs)
      expect(runProcessResult.body.message).to.contain('too long')
      expect(runProcessResult.status).to.equal(400)
    })

    test('add item - invalid metadata type', async function () {
      const outputs = [{ owner: USER_ALICE_TOKEN, metadata: { testKey: { type: 'INVALID', value: 'test' } } }]
      const runProcessResult = await postRunProcess(app, authToken, [], outputs)
      expect(runProcessResult.body.message).to.contain('invalid type')
      expect(runProcessResult.status).to.equal(400)
    })

    test('add item - metadata FILE without value field', async function () {
      const outputs = [{ owner: USER_ALICE_TOKEN, metadata: { testKey: { type: 'FILE' } } }]
      const runProcessResult = await postRunProcess(app, authToken, [], outputs)
      expect(runProcessResult.body.message).to.contain('value')
      expect(runProcessResult.status).to.equal(400)
    })

    test('add item - metadata LITERAL without value field', async function () {
      const outputs = [{ owner: USER_ALICE_TOKEN, metadata: { testKey: { type: 'LITERAL' } } }]
      const runProcessResult = await postRunProcess(app, authToken, [], outputs)
      expect(runProcessResult.body.message).to.contain('value')
      expect(runProcessResult.status).to.equal(400)
    })

    test('add item - metadata LITERAL value too long', async function () {
      const literalValue = 'a'.repeat(METADATA_VALUE_LITERAL_LENGTH + 1)
      const outputs = [{ owner: USER_ALICE_TOKEN, metadata: { testKey: { type: 'LITERAL', value: literalValue } } }]
      const runProcessResult = await postRunProcess(app, authToken, [], outputs)
      expect(runProcessResult.body.message).to.contain('too long')
      expect(runProcessResult.status).to.equal(400)
    })

    test('add item - metadata LITERAL value too long (multibyte character)', async function () {
      const literalValue = '£'.repeat(METADATA_VALUE_LITERAL_LENGTH / 2 + 1)
      const outputs = [{ owner: USER_ALICE_TOKEN, metadata: { testKey: { type: 'LITERAL', value: literalValue } } }]
      const runProcessResult = await postRunProcess(app, authToken, [], outputs)
      expect(runProcessResult.body.message).to.contain('too long')
      expect(runProcessResult.status).to.equal(400)
    })

    test('add item - too many metadata items', async function () {
      const tooMany = {}
      for (let i = 0; i < MAX_METADATA_COUNT + 1; i++) {
        tooMany[`${i}`] = { type: 'NONE' }
      }
      const outputs = [{ owner: USER_ALICE_TOKEN, metadata: tooMany }]

      const runProcessResult = await postRunProcess(app, authToken, [], outputs)
      expect(runProcessResult.body.message).to.contain('too many')
      expect(runProcessResult.status).to.equal(400)
    })

    test('get item - missing ID', async function () {
      const lastToken = await getLastTokenIdRoute(app, authToken)
      const lastTokenId = lastToken.body.id
      const actualResult = await getItemRoute(app, authToken, { id: lastTokenId + 1000 })
      expect(actualResult.status).to.equal(404)
      expect(actualResult.body).to.have.property('message')
    })

    test('get item - invalid ID', async function () {
      const actualResult = await getItemRoute(app, authToken, { id: 0 })
      expect(actualResult.status).to.equal(400)
      expect(actualResult.body.message).to.contain('id')
    })

    test('get item metadata - direct add file', async function () {
      const lastToken = await getLastTokenIdRoute(app, authToken)
      const lastTokenId = lastToken.body.id
      const dir = await addFileRoute('./test/data/test_file_01.txt')
      const { Hash: base58Metadata } = dir.find((r) => r.Name === '')

      const base64Metadata = `0x${bs58.decode(base58Metadata).toString('hex').slice(4)}`

      const key = utf8ToUint8Array('testFile', METADATA_KEY_LENGTH)
      const output = { owner: USER_ALICE_TOKEN, metadata: new Map([[key, { File: base64Metadata }]]) }

      await runProcess([], [output])

      const actualResult = await getItemRoute(app, authToken, { id: lastToken.body.id + 1 })

      const res = await getItemMetadataRoute(app, authToken, { id: lastTokenId + 1, metadataKey: 'testFile' })

      expect(res.text.toString()).equal('This is the first test file...\n')
      expect(res.header['content-disposition']).equal('attachment; filename="test_file_01.txt"')
    })

    test('get item metadata - direct add file (addFileRouteLegacy)', async function () {
      const lastToken = await getLastTokenIdRoute(app, authToken)
      const lastTokenId = lastToken.body.id
      const { Hash: base58Metadata } = await addFileRouteLegacy('./test/data/test_file_01.txt')
      const base64Metadata = `0x${bs58.decode(base58Metadata).toString('hex').slice(4)}`

      const key = utf8ToUint8Array('testFile', METADATA_KEY_LENGTH)
      const output = { owner: USER_ALICE_TOKEN, metadata: new Map([[key, { File: base64Metadata }]]) }

      await runProcess([], [output])

      const res = await getItemMetadataRoute(app, authToken, { id: lastTokenId + 1, metadataKey: 'testFile' })

      expect(res.text.toString()).equal('This is the first test file...\n')
      expect(res.header['content-disposition']).equal('attachment; filename="metadata"')
    })

    test('get item metadata - missing ID', async function () {
      const lastToken = await getLastTokenIdRoute(app, authToken)
      const lastTokenId = lastToken.body.id
      const actualResult = await getItemMetadataRoute(app, authToken, {
        id: lastTokenId + 1000,
      })

      expect(actualResult.status).to.equal(404)
      expect(actualResult.body).to.have.property('message')
    })

    test('get item metadata - missing metadataKey', async function () {
      const lastToken = await getLastTokenIdRoute(app, authToken)
      const lastTokenId = lastToken.body.id
      const actualResult = await getItemMetadataRoute(app, authToken, {
        id: lastTokenId,
        metadataKey: 'missingKey',
      })

      expect(actualResult.status).to.equal(404)
      expect(actualResult.body).to.have.property('message')
    })

    test('get invalid item metadata', async function () {
      const actualResult = await getItemMetadataRoute(app, authToken, { id: 0 })

      expect(actualResult.body.message).to.contain('id')
      expect(actualResult.body).to.have.property('message')
    })

    test('run-process creating one token (legacy metadataFile)', async function () {
      const lastToken = await getLastTokenIdRoute(app, authToken)
      const lastTokenId = lastToken.body.id

      let expectedResult = [lastTokenId + 1]

      const outputs = [{ owner: USER_BOB_TOKEN, metadataFile: './test/data/test_file_04.txt' }]
      const actualResult = await postRunProcess(app, authToken, [], outputs)

      expect(actualResult.status).to.equal(200)
      expect(actualResult.body).to.deep.equal(expectedResult)

      const item = await getItemRoute(app, authToken, { id: lastTokenId + 1 })

      expectedResult = {
        id: lastTokenId + 1,
        creator: USER_ALICE_TOKEN,
        owner: USER_BOB_TOKEN,
        parents: [],
        children: null,
        metadata: [LEGACY_METADATA_KEY],
      }
      assertItem(item.body, expectedResult)

      const itemMetadata = await getItemMetadataRouteLegacy(app, authToken, {
        id: lastTokenId + 1,
      })
      expect(itemMetadata.text.toString()).equal('This is the fourth test file...\n')
    })

    test('run-process creating one token', async function () {
      const lastToken = await getLastTokenIdRoute(app, authToken)
      const lastTokenId = lastToken.body.id

      let expectedResult = [lastTokenId + 1]

      const outputs = [
        { owner: USER_BOB_TOKEN, metadata: { testFile: { type: 'FILE', value: './test/data/test_file_01.txt' } } },
      ]
      const actualResult = await postRunProcess(app, authToken, [], outputs)

      expect(actualResult.status).to.equal(200)
      expect(actualResult.body).to.deep.equal(expectedResult)

      const item = await getItemRoute(app, authToken, { id: lastTokenId + 1 })

      expectedResult = {
        id: lastTokenId + 1,
        creator: USER_ALICE_TOKEN,
        owner: USER_BOB_TOKEN,
        parents: [],
        children: null,
        metadata: ['testFile'],
      }
      assertItem(item.body, expectedResult)

      const itemMetadata = await getItemMetadataRoute(app, authToken, {
        id: lastTokenId + 1,
        metadataKey: 'testFile',
      })
      expect(itemMetadata.text.toString()).equal('This is the first test file...\n')
    })

    test('run-process destroying one token and creating one', async function () {
      const lastToken = await getLastTokenIdRoute(app, authToken)
      const lastTokenId = lastToken.body.id

      let expectedResult = [lastTokenId + 2]

      await postRunProcess(
        app,
        authToken,
        [],
        [
          {
            owner: USER_ALICE_TOKEN,
            metadata: { testFile: { type: 'FILE', value: './test/data/test_file_01.txt' } },
          },
        ]
      )

      const outputs = [
        { owner: USER_BOB_TOKEN, metadata: { testFile: { type: 'FILE', value: './test/data/test_file_04.txt' } } },
      ]
      const actualResult = await postRunProcess(app, authToken, [lastTokenId + 1], outputs)

      expect(actualResult.status).to.equal(200)
      expect(actualResult.body).to.deep.equal(expectedResult)

      let item = await getItemRoute(app, authToken, { id: lastTokenId + 1 })

      expectedResult = {
        id: lastTokenId + 1,
        creator: USER_ALICE_TOKEN,
        owner: USER_ALICE_TOKEN,
        parents: [],
        children: [lastTokenId + 2],
        metadata: ['testFile'],
      }

      assertItem(item.body, expectedResult)

      const itemNew = await getItemRoute(app, authToken, { id: lastTokenId + 2 })

      expectedResult = {
        id: lastTokenId + 2,
        creator: USER_ALICE_TOKEN,
        owner: USER_BOB_TOKEN,
        parents: [lastTokenId + 1],
        children: null,
        metadata: ['testFile'],
      }

      assertItem(itemNew.body, expectedResult)
    })
  })
})
