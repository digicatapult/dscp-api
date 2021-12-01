const logger = require('../../logger')
const formidable = require('formidable')
const { containsInvalidMembershipOwners, validateInputIds, processMetadata } = require('../../util/appUtil')
const { LEGACY_METADATA_KEY } = require('../../env')

module.exports = function (apiService) {
  const doc = {
    GET: async function (req, res) {
      const form = formidable({ multiples: true })

      form.parse(req, async (formError, fields, files) => {
        try {
          if (formError) {
            logger.error(`Error processing form ${formError}`)
            res.status(500).json({ message: 'Unexpected error processing input' })
            return
          }

          let request = null
          try {
            request = JSON.parse(fields.request)
          } catch (parseError) {
            logger.trace(`Invalid user input ${parseError}`)
            res.status(400).json({ message: `Invalid user input ${parseError}` })
            return
          }

          if (!request || !request.inputs || !request.outputs) {
            logger.trace(`Request missing input and/or outputs`)
            res.status(400).json({ message: `Request missing input and/or outputs` })
            return
          } else if (request.outputs && (await containsInvalidMembershipOwners(request.outputs))) {
            logger.trace(`Request contains invalid owners that are not members of the membership list`)
            res
              .status(400)
              .json({ message: `Request contains invalid owners that are not members of the membership list` })
            return
          }

          const inputsValid = await validateInputIds(request.inputs)
          if (!inputsValid) {
            logger.trace(`Some inputs were invalid`)
            res.status(400).json({ message: `Some inputs were invalid: ${JSON.stringify(request.inputs)}` })
            return
          }

          const outputs = await Promise.all(
            request.outputs.map(async (output) => {
              //catch legacy single metadataFile
              if (output.metadataFile) {
                output.metadata = { [LEGACY_METADATA_KEY]: { type: 'FILE', value: output.metadataFile } }
              }
              try {
                return {
                  owner: output.owner,
                  metadata: await processMetadata(output.metadata, files),
                }
              } catch (err) {
                logger.trace(`Invalid metadata: ${err.message}`)
                res.status(400).json({ message: err.message })
                return
              }
            })
          )
          const result = await apiService.runProcess(request.inputs, outputs)

          if (result) {
            res.status(200).json(result)
          } else {
            logger.error(`Unexpected error running process ${result}`)
            res.status(500).json({
              message: `Unexpected error processing items`,
            })
          }
        } catch (err) {
          logger.error(`Error running process. Error was ${err.message || JSON.stringify(err)}`)
          if (!res.headersSent) {
            res.status(500).send(`Error running process`)
          }
        }
      })
    },
  }

  doc.GET.apiDoc = {
    summary: 'Governs the creation and destruction of all tokens in the system',
    responses: {
      200: {
        description: 'Return tokens consumed and those to be created by this running process',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/RunProcess',
            },
          },
        },
      },
      400: {
        description: 'Invalid request',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/responses/BadRequestError',
            },
          },
        },
      },
      default: {
        description: 'An error occurred',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/responses/Error',
            },
          },
        },
      },
    },
    tags: ['system'],
  }

  return doc
}