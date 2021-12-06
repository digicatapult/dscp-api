const logger = require('../../logger')
const { membershipReducer } = require('../../util/appUtil')

module.exports = function (apiService) {
  const doc = {
    GET: async function (req, res) {
      try {
        const members = await apiService.findMembers()
        const membershipMembers = membershipReducer(members)

        res.status(200).json(membershipMembers)
      } catch (err) {
        logger.error(`Error getting members. Error was ${err.message || JSON.stringify(err)}`)
        if (!res.headersSent) {
          res.status(500).send(`Error getting members`)
        }
      }
    },
  }

  doc.GET.apiDoc = {
    summary: 'Get members',
    responses: {
      200: {
        description: 'Return members',
        content: {
          'application/json': {
            schema: {
              type: 'array',
              items: {
                $ref: '#/components/schemas/Member',
              },
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
