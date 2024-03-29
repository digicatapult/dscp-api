import createJWKSMock from 'mock-jwks'
import { describe, test, before, after } from 'mocha'
import { expect } from 'chai'
import nock from 'nock'

/* eslint no-console: "off" */

import request from 'supertest'

import { createHttpServer } from '../../app/server.js'
import { getItemRoute, getLastTokenIdRoute } from '../helper/routeHelper.js'
const USER_ALICE_TOKEN = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY'
import { indexToRole } from '../../app/util/appUtil.js'
import env from '../../app/env.js'
import { withNewTestProcess } from '../helper/substrateHelper.js'

const { API_MAJOR_VERSION, AUTH_ISSUER, AUTH_AUDIENCE, AUTH_TYPE } = env
const describeAuthOnly = AUTH_TYPE === 'JWT' ? describe : describe.skip

describeAuthOnly('Bug regression tests', function () {
  describe('API run-process is broken with file uploads (https://github.com/digicatapult/dscp-api/issues/17)', function () {
    let app
    let jwksMock
    let authToken
    let statusHandler
    let process = {}

    before(async () => {
      nock.disableNetConnect()
      nock.enableNetConnect((host) => host.includes('127.0.0.1') || host.includes('localhost'))
    })

    after(() => {
      nock.abortPendingRequests()
      nock.cleanAll()
    })

    before(async function () {
      const server = await createHttpServer()
      app = server.app
      statusHandler = server.statusHandler

      jwksMock = createJWKSMock(AUTH_ISSUER)
      jwksMock.start()
      authToken = jwksMock.token({
        aud: AUTH_AUDIENCE,
        iss: AUTH_ISSUER,
      })
    })

    withNewTestProcess(process)

    after(async function () {
      await jwksMock.stop()
    })

    after(function () {
      statusHandler.close()
    })

    test('add and get item - single metadata FILE', async function () {
      const defaultRole = { [await indexToRole(0)]: USER_ALICE_TOKEN }
      const outputs = [{ roles: defaultRole, metadata: { testFile: { type: 'FILE', value: 'test_file_01.txt' } } }]

      let req = request(app)
        .post(`/${API_MAJOR_VERSION}/run-process`)
        .set('Accept', 'application/json')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${authToken}`)
        .field(
          'request',
          JSON.stringify({
            process,
            inputs: [],
            outputs,
          })
        )

      outputs.forEach((output) => {
        if (output.metadata) {
          for (const value of Object.values(output.metadata)) {
            if (value.type === 'FILE') {
              req.attach(value.value, `./test/data/${value.value}`)
            }
          }
        }
      })

      const runProcessResult = await req
        .then((response) => {
          return response
        })
        .catch((err) => {
          console.error(`addItemErr ${err}`)
          return err
        })

      expect(runProcessResult.body).to.have.length(1)
      expect(runProcessResult.status).to.equal(200)
      const lastToken = await getLastTokenIdRoute(app, authToken)
      expect(lastToken.body).to.have.property('id')

      const getItemResult = await getItemRoute(app, authToken, lastToken.body)
      expect(getItemResult.status).to.equal(200)
      expect(getItemResult.body.id).to.equal(lastToken.body.id)
      expect(getItemResult.body.metadata_keys).to.deep.equal(['testFile'])
    })
  })
})
