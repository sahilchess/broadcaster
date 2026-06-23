require("dotenv").config();
const { App } = require("@slack/bolt");

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true
});

const reviewChannel = process.env.REVIEW_CHANNEL_ID;
const targetChannel = process.env.TARGET_CHANNEL_ID;

// ping test
app.command("/broadcaster-ping", async ({ command, ack, respond }) => {
  const start = Date.now();
  await ack();
  const latency = Date.now() - start;
  await respond({ text: `pong\nlatency: ${latency}ms` });
});

// opens the submission modal
app.command("/broadcaster-enter", async ({ ack, body, client }) => {
  await ack();

  await client.views.open({
    trigger_id: body.trigger_id,
    view: {
      type: "modal",
      callback_id: "broadcaster_submit",
      private_metadata: body.user_id,
      title: { type: "plain_text", text: "community announcement" },
      submit: { type: "plain_text", text: "submit for review" },
      close: { type: "plain_text", text: "cancel" },
      blocks: [
        {
          type: "input",
          block_id: "message_block",
          label: { type: "plain_text", text: "what do you want to say in #community-announcements?" },
          element: {
            type: "plain_text_input",
            action_id: "message_input",
            multiline: true
          }
        }
      ]
    }
  });
});

// modal submit, send to review channel with approve edit and reject buttons
app.view("broadcaster_submit", async ({ ack, view, client }) => {
  await ack();

  const submitterId = view.private_metadata;
  const text = view.state.values.message_block.message_input.value;

  await postReviewMessage(client, submitterId, text);
});

async function postReviewMessage(client, submitterId, text) {
  const submitterInfo = await client.users.info({ user: submitterId });
  const submitterName = submitterInfo.user.real_name || submitterInfo.user.name;

  await client.chat.postMessage({
    channel: reviewChannel,
    text: `new community announcement request from ${submitterName}`,
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: `*new community announcement request*\nfrom: <@${submitterId}>` }
      },
      {
        type: "section",
        block_id: "message_text",
        text: { type: "mrkdwn", text: text }
      },
      {
        type: "actions",
        block_id: "review_actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "approve" },
            style: "primary",
            action_id: "approve_broadcaster",
            value: JSON.stringify({ submitterId, text })
          },
          {
            type: "button",
            text: { type: "plain_text", text: "edit" },
            action_id: "edit_broadcaster",
            value: JSON.stringify({ submitterId, text })
          },
          {
            type: "button",
            text: { type: "plain_text", text: "reject" },
            style: "danger",
            action_id: "reject_broadcaster",
            value: JSON.stringify({ submitterId, text })
          }
        ]
      }
    ]
  });
}

// approve, post to target channel as the submitter, update review message
app.action("approve_broadcaster", async ({ ack, body, client }) => {
  await ack();

  const { submitterId, text } = JSON.parse(body.actions[0].value);
  await postAsSubmitter(client, submitterId, text);

  await client.chat.update({
    channel: body.channel.id,
    ts: body.message.ts,
    text: `approved and posted, submitted by <@${submitterId}>`,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `*approved* by <@${body.user.id}>\n${text}` } }
    ]
  });

  await client.chat.postMessage({
    channel: submitterId,
    text: "your community announcement was approved and posted"
  });
});

// edit, opens a modal pre filled with the current text, head edits then resubmits
app.action("edit_broadcaster", async ({ ack, body, client }) => {
  await ack();

  const { submitterId, text } = JSON.parse(body.actions[0].value);

  await client.views.open({
    trigger_id: body.trigger_id,
    view: {
      type: "modal",
      callback_id: "broadcaster_edit_submit",
      private_metadata: JSON.stringify({
        submitterId,
        reviewChannel: body.channel.id,
        reviewTs: body.message.ts
      }),
      title: { type: "plain_text", text: "edit announcement" },
      submit: { type: "plain_text", text: "save and approve" },
      close: { type: "plain_text", text: "cancel" },
      blocks: [
        {
          type: "input",
          block_id: "message_block",
          label: { type: "plain_text", text: "edit the message" },
          element: {
            type: "plain_text_input",
            action_id: "message_input",
            multiline: true,
            initial_value: text
          }
        }
      ]
    }
  });
});

// edited modal submit, post edited text as submitter, update review message
app.view("broadcaster_edit_submit", async ({ ack, view, client }) => {
  await ack();

  const { submitterId, reviewChannel: reviewChannelId, reviewTs } = JSON.parse(view.private_metadata);
  const editedText = view.state.values.message_block.message_input.value;

  await postAsSubmitter(client, submitterId, editedText);

  await client.chat.update({
    channel: reviewChannelId,
    ts: reviewTs,
    text: `approved with edits, submitted by <@${submitterId}>`,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `*approved with edits*\n${editedText}` } }
    ]
  });

  await client.chat.postMessage({
    channel: submitterId,
    text: "your community announcement was approved, with edits, and posted"
  });
});

// reject, update review message, dm submitter
app.action("reject_broadcaster", async ({ ack, body, client }) => {
  await ack();

  const { submitterId, text } = JSON.parse(body.actions[0].value);

  await client.chat.update({
    channel: body.channel.id,
    ts: body.message.ts,
    text: `rejected, submitted by <@${submitterId}>`,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `*rejected* by <@${body.user.id}>\n${text}` } }
    ]
  });

  await client.chat.postMessage({
    channel: submitterId,
    text: "your community announcement was not approved by the heads"
  });
});

// posts to the target channel using the submitter's name and pfp
async function postAsSubmitter(client, submitterId, text) {
  const info = await client.users.info({ user: submitterId });
  const profile = info.user.profile;
  const displayName = profile.display_name || info.user.real_name || info.user.name;

  await client.chat.postMessage({
    channel: targetChannel,
    text: text,
    username: displayName,
    icon_url: profile.image_192 || profile.image_72,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: text } },
    ]
  });
}

(async () => {
  await app.start();
  console.log("bot is running!");
})();
