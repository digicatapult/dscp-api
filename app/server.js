const express = require('express')
const cors = require('cors')
const pinoHttp = require('pino-http')
const { initialize } = require('express-openapi')
const swaggerUi = require('swagger-ui-express')
const path = require('path')

const { PORT, API_MAJOR_VERSION } = require('./env')
const logger = require('./logger')
const router = require('./routes')
const health = require('./routes/health')
const auth = require('./routes/auth')
const checkJwt = require('./auth')
const v2ApiDoc = require('./api-v2/api-doc')
const v2ApiService = require('./api-v2/services/apiService')

async function createHttpServer() {
  const requestLogger = pinoHttp({ logger })
  const app = express()

  app.use(express.json())
  app.use(cors())
  app.use((req, res, next) => {
    if (req.path !== '/health') {
      requestLogger(req, res)
    }
    next()
  })

  app.use('/health', health)
  // app.use('/auth', auth)
  // app.use('/', checkJwt, router)

  initialize({
    app,
    apiDoc: v2ApiDoc,
    dependencies: {
      apiService: v2ApiService,
    },
    paths: [path.resolve(__dirname, `api-${API_MAJOR_VERSION}/routes`)],
  })

  const options = {
    swaggerOptions: {
      urls: [
        {
          url: `http//localhost:${PORT}/${API_MAJOR_VERSION}/api-docs`,
          name: 'ApiService',
        },
      ],
    },
  }

  app.use(`/${API_MAJOR_VERSION}/swagger`, swaggerUi.serve, swaggerUi.setup(null, options))

  // Sorry - app.use checks arity
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.status) {
      res.status(err.status).send({ error: err.status === 401 ? 'Unauthorised' : err.message })
    } else {
      logger.error('Fallback Error %j', err.stack)
      res.status(500).send('Fatal error!')
    }
  })

  return app
}

async function startServer() {
  const app = await createHttpServer()

  app.listen(PORT, (err) => {
    if (err) {
      logger.error('Error  starting app:', err)
      throw err
    } else {
      logger.info(`Server is listening on port ${PORT}`)
    }
  })
}

module.exports = { startServer, createHttpServer }
