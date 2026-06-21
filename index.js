require('dotenv').config()
const { App } = require('@slack/bolt')

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN
})

const reviewChannel = process.env.REVIEW_CHANNEL_ID
const targetChannel = process.env.TARGET_CHANNEL_ID

// /ca-enter opens the modal
app.command('/ca-enter', async ({ ack, body, client }) => {
  await ack()

  await client.views.open({
    trigger_id: body.trigger_id,
    view: {
      type: 'modal',
      callback_id: 'ca_submit',
      private_metadata: body.user_id,
      title: { type: 'plain_text', text: 'community announcement' },
      submit: { type: 'plain_text', text: 'submit for review' },
      close: { type: 'plain_text', text: 'cancel' },
      blocks: [
        {
          type: 'input',
          block_id: 'message_block',
          label: { type: 'plain_text', text: 'what do you want to say in #community-announcements?' },
          element: {
            type: 'plain_text_input',
            action_id: 'message_input',
            multiline: true
          }
        }
      ]
    }
  })
})

// modal submit, send to review channel with approve and reject buttons
app.view('ca_submit', async ({ ack, view, client }) => {
  await ack()

  const submitterId = view.private_metadata
  const text = view.state.values.message_block.message_input.value

  const submitterInfo = await client.users.info({ user: submitterId })
  const submitterName = submitterInfo.user.real_name || submitterInfo.user.name

  await client.chat.postMessage({
    channel: reviewChannel,
    text: `new community announcement request from ${submitterName}`,
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*new community announcement request*\nfrom: <@${submitterId}>` }
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: text }
      },
      {
        type: 'actions',
        block_id: 'review_actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'approve' },
            style: 'primary',
            action_id: 'approve_ca',
            value: JSON.stringify({ submitterId, text })
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: 'reject' },
            style: 'danger',
            action_id: 'reject_ca',
            value: JSON.stringify({ submitterId, text })
          }
        ]
      }
    ]
  })
})

// approve, post to target channel, update review message
app.action('approve_ca', async ({ ack, body, client }) => {
  await ack()

  const { submitterId, text } = JSON.parse(body.actions[0].value)

  await client.chat.postMessage({
    channel: targetChannel,
    text: text,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: text } },
      { type: 'context', elements: [{ type: 'mrkdwn', text: `submitted by <@${submitterId}>` }] }
    ]
  })

  await client.chat.update({
    channel: body.channel.id,
    ts: body.message.ts,
    text: `approved and posted, submitted by <@${submitterId}>`,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: `*approved* by <@${body.user.id}>\n${text}` } }
    ]
  })

  await client.chat.postMessage({
    channel: submitterId,
    text: 'your community announcement was approved and posted'
  })
})

// reject, update review message, dm submitter
app.action('reject_ca', async ({ ack, body, client }) => {
  await ack()

  const { submitterId, text } = JSON.parse(body.actions[0].value)

  await client.chat.update({
    channel: body.channel.id,
    ts: body.message.ts,
    text: `rejected, submitted by <@${submitterId}>`,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: `*rejected* by <@${body.user.id}>\n${text}` } }
    ]
  })

  await client.chat.postMessage({
    channel: submitterId,
    text: 'your community announcement was not approved by the heads'
  })
})

;(async () => {
  await app.start()
  console.log('ca-bot running')
})()