import Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'
import { TRUCK_TYPES, GROUND_REASONS, PM_REASONS } from '@/lib/constants'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req) {
  try {
    const { input, context } = await req.json()
    if (!input?.trim()) return NextResponse.json({ error: 'No input' }, { status: 400 })

    const sys = `You are an operations assistant for a truck rental yard. You understand fleet vocabulary.
TRUCK TYPES: ${TRUCK_TYPES.join(', ')}
LINES: RL (Ready Line), WL (Wash Line), SRL (Service Ready), SL (Service Line), SHOP (Shop/Deadline)
GROUND REASONS: ${GROUND_REASONS.join(', ')}
PM REASONS: ${PM_REASONS.join(', ')}

CURRENT FLEET STATE:
${JSON.stringify(context, null, 2)}

Parse the user command and return ONE JSON action. Include a "summary" field (one plain-English sentence).

AVAILABLE ACTIONS:
{"type":"add_unit","unit":"str","tt":"str","line":"RL","isPuro":false,"note":"str","summary":"str"}
{"type":"going_out","unit":"str","customer":"str","returnDate":"YYYY-MM-DD","summary":"str"}
{"type":"went_out","unit":"str","customer":"str","returnDate":"YYYY-MM-DD","summary":"str"}
{"type":"came_back","unit":"str","line":"WL","summary":"str"}
{"type":"ground_unit","unit":"str","reason":"CFI","estimatedReadyDate":"YYYY-MM-DD","note":"str","summary":"str"}
{"type":"return_from_ground","unit":"str","line":"SRL","summary":"str"}
{"type":"schedule_pm","unit":"str","reason":"Routine PM","note":"str","summary":"str"}
{"type":"advance_pm","unit":"str","summary":"str"}
{"type":"hike_out","unit":"str","destination":"str","summary":"str"}
{"type":"hike_in","unit":"str","from":"str","summary":"str"}
{"type":"confirm_arrival","unit":"str","summary":"str"}
{"type":"add_tomorrow","unit":"str","tt":"str","hold":false,"note":"str","summary":"str"}
{"type":"update_line","unit":"str","line":"RL","summary":"str"}
{"type":"remove_unit","unit":"str","summary":"str"}
{"type":"clarify","question":"str"}
{"type":"unknown","message":"str"}

RULES:
- CFI = Compliance/Fleet Inspection → urgent ground
- "Ground X for CFI" = ground_unit with reason CFI
- "X is back" / "X returned" = came_back
- "X going out to Y" = going_out (not yet confirmed)
- "X went out to Y" = went_out (confirmed, moves to reso)
- "Put X on WL/RL" = update_line
- "Need a 26ft tomorrow" = add_tomorrow with tt 26ft
- Return ONLY valid JSON. No markdown, no explanation outside the JSON.`

    const msg = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 512,
      system: sys,
      messages: [{ role: 'user', content: input }],
    })

    const raw    = msg.content.find(b => b.type === 'text')?.text ?? '{}'
    const clean  = raw.replace(/```json|```/g, '').trim()
    const action = JSON.parse(clean)

    return NextResponse.json({ action })
  } catch (err) {
    console.error('AI route error:', err)
    return NextResponse.json({ error: err.message ?? 'AI error' }, { status: 500 })
  }
}
