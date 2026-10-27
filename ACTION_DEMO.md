# Free checkout action setup

Use the shop origin as the base URL: `http://localhost:3000` locally, or your deployed shop's HTTPS origin. Keep the browser and action URLs on the same origin so the demo cookie is available.

Create the three helper actions first, then the main action. Enable Kiku access for all four. Leave **Require sign-in** off. This flow charges nothing.

| Name | Method | API | Description |
| --- | --- | --- | --- |
| `demo_before` | GET | `/api/demo/before` | Check whether the free demo is ready. Continue with demo_checkout only when ready is true. No payment or cart is needed. |
| `demo_checkout` | POST | `/api/demo/checkout` | Start a FREE simulated checkout. First run demo_before and require ready=true. Success means the demo session was created (created=true), not that checkout was completed. After creation run demo_after with the returned demo_id. Give the visitor checkout_url to open. On return run demo_on_return with the same demo_id and report completed, cancelled, or pending exactly as returned. Never call the real checkout for this demo. |
| `demo_after` | POST | `/api/demo/after` | Record successful creation of a free demo session. Use demo_id from demo_checkout. This confirms session creation, not checkout completion or payment. |
| `demo_on_return` | GET | `/api/demo/on-return` | Read the free demo outcome after the visitor returns from checkout_url. Use demo_id from demo_checkout. Only completed confirms demo completion; cancelled and pending are not success. Nothing is charged. |

## Fields for demo_before and demo_checkout

Paste this JSON Schema into Inputs:

```json
{
  "type": "object",
  "properties": {},
  "required": [],
  "additionalProperties": false
}
```

## Fields for demo_after and demo_on_return

```json
{
  "type": "object",
  "properties": {
    "demo_id": {
      "type": "string",
      "description": "The demo_id returned by demo_checkout."
    }
  },
  "required": ["demo_id"],
  "additionalProperties": false
}
```

The after endpoint receives JSON, for example `{"demo_id":"the-returned-uuid"}`. The return endpoint receives a query parameter: `/api/demo/on-return?demo_id=the-returned-uuid`. Kiku fills these from the main action's response.

## Behavior for demo_checkout

- Before: `demo_before`
- After success: `demo_after`
- On return: `demo_on_return`

Ask Kiku in chat: **Start the free demo checkout.** Open its link, choose **Complete demo — $0** or **Cancel demo**, then switch back to the same chat tab.

`/action-demo.html` provides a direct API runner and browser-specific endpoint activity. It exercises the endpoints independently of Kiku. `/api/demo/actions` returns the complete action definitions. After success records session creation; on return checks the later visitor outcome. Returning without a choice remains pending.

Demo requests are limited to 60/minute per server-observed IP, with 20 sessions per browser per day and 1,000 retained sessions overall. Records expire after 24 hours; activity is capped at 10,000 entries. In a multi-instance deployment, IP limits are per instance. Demo state uses the shop database, so Vercel's current temporary SQLite storage can reset between instances or cold starts.
