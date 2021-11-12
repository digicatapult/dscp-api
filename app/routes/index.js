const express = require('express')
const formidable = require('formidable')

const {
  getLastTokenId,
  getItem,
  runProcess,
  processMetadata,
  getMetadata,
  validateTokenIds,
  processMultipleMetadata,
} = require('../util/appUtil')
const logger = require('../logger')

const router = express.Router()

router.get('/last-token', async (req, res) => {
  try {
    const result = await getLastTokenId()
    res.status(200).json({ id: result })
  } catch (err) {
    logger.error(`Error getting latest token. Error was ${err.message || JSON.stringify(err)}`)
    if (!res.headersSent) {
      res.status(500).send(`Error getting latest token`)
    }
  }
})

router.get('/item/:id', async (req, res) => {
  try {
    const id = req.params && parseInt(req.params.id, 10)
    if (Number.isInteger(id) && id !== 0) {
      const result = await getItem(id)
      delete result.metadata

      if (result.id === id) {
        res.status(200).json(result)
      } else {
        res.status(404).json({
          message: `Id not found: ${id}`,
        })
      }
    } else {
      res.status(400).json({
        message: `Invalid id: ${id}`,
      })
    }
  } catch (err) {
    logger.error(`Error token. Error was ${err.message || JSON.stringify(err)}`)
    if (!res.headersSent) {
      res.status(500).send(`Error getting token`)
    }
  }
})

router.get('/item/:id/metadata', async (req, res) => {
  const id = req.params && parseInt(req.params.id, 10)
  if (Number.isInteger(id) && id !== 0) {
    const { metadata: hash, id: getId } = await getItem(id)
    if (getId === id) {
      try {
        const { file, filename } = await getMetadata(hash)

        await new Promise((resolve, reject) => {
          res.status(200)
          res.set({
            immutable: true,
            maxAge: 365 * 24 * 60 * 60 * 1000,
            'Content-Disposition': `attachment; filename="${filename}"`,
          })
          file.pipe(res)
          file.on('error', (err) => reject(err))
          res.on('finish', () => resolve())
        })
        return
      } catch (err) {
        logger.warn(`Error sending metadata file. Error was ${err}`)
        if (!res.headersSent) {
          res.status(500).send(`Error fetching metadata file`)
          return
        }
      }
    } else {
      res.status(404).json({
        message: `Id not found: ${id}`,
      })
      return
    }
  }
  res.status(400).json({
    message: `Invalid id: ${id}`,
  })
})

router.post('/run-process', async (req, res) => {
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
      }

      const inputsValid = await validateTokenIds(request.inputs)
      if (!inputsValid) {
        logger.trace(`Some inputs were invalid`)
        res.status(400).json({ message: `Some inputs were invalid: ${JSON.stringify(request.inputs)}` })
        return
      }

      //catch legacy single metadataFile outputs
      let outputs = request.outputs.map((output) => {
        if (output.metadataFile) {
          return {
            owner: output.owner,
            metadata: [{ '': output.metadataFile }],
          }
        } else {
          return output
        }
      })

      outputs = await Promise.all(
        outputs.map(async (output) => ({
          owner: output.owner,
          metadata: await processMetadata(output.metadata, files),
        }))
      )

      const result = await runProcess(request.inputs, outputs)

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
})

module.exports = router
