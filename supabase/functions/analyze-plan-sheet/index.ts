const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type TrackableKind = 'exercise' | 'habit'
type TargetType = 'count' | 'sets' | 'duration' | 'distance' | 'for-time' | 'weighted'
type ProgressMetric = 'count' | 'time' | 'weight'
type ReferenceMode = 'last-result' | 'personal-best'

type RequestBody = {
  fileName?: string
  sheets?: Array<{ name?: string; rows?: string[][] }>
  catalog?: Array<{ name?: string; kind?: TrackableKind; category?: string; defaultType?: TargetType }>
}

const schemaExample = {
  summary: 'Short summary of what the spreadsheet appears to contain.',
  warnings: ['Any ambiguities or issues worth showing to the user.'],
  items: [
    {
      name: 'Push-Ups',
      kind: 'exercise',
      category: 'Bodyweight',
      notes: 'Optional note about this trackable.',
      defaultType: 'count',
      progressMetric: 'count',
      usedOnDays: ['Day 1', 'Day 4'],
    },
  ],
  days: [
    {
      label: 'Day 1',
      notes: 'Optional note for the day.',
      items: [
        {
          name: 'Push-Ups',
          type: 'count',
          target: { count: 50 },
          ref: 'last-result',
          note: '',
        },
      ],
    },
  ],
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const openAiKey = Deno.env.get('OPENAI_API_KEY')
    if (!openAiKey) {
      return new Response(JSON.stringify({ error: 'Missing OPENAI_API_KEY secret.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const body = await req.json() as RequestBody
    const sheets = (body.sheets ?? [])
      .map((sheet) => ({
        name: `${sheet.name ?? 'Sheet'}`.trim(),
        rows: Array.isArray(sheet.rows) ? sheet.rows.slice(0, 180).map((row) => row.slice(0, 20).map((cell) => `${cell ?? ''}`.trim())) : [],
      }))
      .filter((sheet) => sheet.rows.length > 0)

    if (sheets.length === 0) {
      return new Response(JSON.stringify({ error: 'No readable sheets were provided.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const catalog = (body.catalog ?? [])
      .filter((item) => item.name)
      .map((item) => ({
        name: item.name?.trim(),
        kind: item.kind === 'habit' ? 'habit' : 'exercise',
        category: item.category?.trim() || '',
        defaultType: item.defaultType || 'count',
      }))

    const systemPrompt = [
      'You analyze workout and discipline spreadsheets and convert them into a structured plan preview for an app.',
      'Return valid JSON only. Do not wrap it in markdown.',
      'Infer trackables as either "exercise" or "habit".',
      'Use one of these target types only: count, sets, duration, distance, for-time, weighted.',
      'Use one of these progress metrics only: count, time, weight.',
      'Use one of these refs only: last-result, personal-best.',
      'Keep labels user-friendly and consistent across the items list and day items.',
      'If the spreadsheet is ambiguous, add warnings but still produce the best usable draft.',
      'If an item appears to already exist in the catalog, keep the same human-readable name as the catalog item when reasonable.',
      `Use this JSON shape: ${JSON.stringify(schemaExample)}`,
    ].join(' ')

    const userPrompt = JSON.stringify({
      fileName: body.fileName ?? 'spreadsheet',
      catalog,
      sheets,
    })

    const openAiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: Deno.env.get('OPENAI_PLAN_MODEL') ?? 'gpt-4.1-mini',
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    })

    if (!openAiResponse.ok) {
      const errorText = await openAiResponse.text()
      return new Response(JSON.stringify({ error: 'OpenAI request failed.', details: errorText }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const completion = await openAiResponse.json()
    const content = completion?.choices?.[0]?.message?.content
    if (!content || typeof content !== 'string') {
      return new Response(JSON.stringify({ error: 'OpenAI response was empty.' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const parsed = JSON.parse(content)
    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
