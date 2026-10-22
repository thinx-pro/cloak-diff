// Scores how much a piece of text reads like an instruction aimed at a model.
// Three families of signals:
//   address  – the text talks *to* a model/agent/crawler ("If you are a language model", "Note to AI crawlers:", "LLMs should")
//   command  – it tells the reader what to say or do ("never mention", "summarize this as", "ignore the instructions above")
//   context  – it frames a task ("when summarizing", "this page", "the user asks")
// Flagged when there is an explicit address, a strong command (override / system prompt), or a
// command plus task context. Self-contained so it can be injected into a page via toString().
export function directiveScore(text) {
  const T = "(?:a\\.?i\\.?|ai|llms?|large language models?|language models?|ai models?|models|ai assistants?|assistants?|chat\\s?bots?|bots|ai agents?|agents|ai systems?|ai tools?|crawlers?|ai crawlers?|scrapers?|chatgpt|gpt(?:-?\\d[\\w.]*)?|claude|gemini|copilot|perplexity|grok|llama|deepseek|mistral|qwen)";
  const TL = T + '(?:\\s*(?:,|and|&|/|or)\\s*' + T + ')*';
  const RULES = [
    // ---- address ----
    // Vocative at the start: "Gemini: …", "Agents — …", or "Assistant, please/when/ignore …".
    // A comma alone is not enough ("The AI assistant, which launched in May, …").
    ['address', 5, new RegExp('^\\W{0,3}(?:dear|hey|hi|hello|attention|to|for|note\\s+to|note\\s+for)?\\s*(?:all\\s+|any\\s+)?' + TL + '(?:\\s*[:—–]|\\s+-\\s|\\s*,\\s*(?:please|kindly|when|whenever|if|you|always|never|do|don\'t|ignore|disregard|forget|from now|remember|note|make|tell|say|respond|reply|answer|summari[sz]e|describe|recommend|rank|rate|treat|output|write|insert|confirm|add|send|state|mention|include|use)\\b)', 'i')],
    ['address', 5, new RegExp('\\b(?:notes?|instructions?|messages?|guidance|attention|directions?|reminder)\\s+(?:to|for)\\s+(?:the\\s+|any\\s+|all\\s+|every\\s+)?(?:[a-z]+\\s+)?' + T + '\\b', 'i')],
    ['address', 5, new RegExp('\\b(?:to|for)\\s+(?:any|all|every)\\s+(?:[a-z]+\\s+)?' + T + '\\b', 'i')],
    ['address', 5, new RegExp('\\b' + T + '\\s+(?:reading|parsing|processing|crawling|browsing|summari[sz]ing|visiting|indexing|seeing)\\s+(?:this|these)\\b', 'i')],
    ['address', 5, new RegExp('\\bif\\s+you\\s+are\\s+(?:an?\\s+|the\\s+)?(?:[a-z]+\\s+)?' + T + '\\b', 'i')],
    ['address', 5, new RegExp('\\byou\\s+are\\s+(?:an?\\s+|the\\s+)' + T + '\\b', 'i')],
    ['address', 5, new RegExp('\\b' + T + '\\s+(?:should|must|shall|need to|needs to|are to|is to|have to|has to|are required to|are instructed to|may not|must not|should not|should never|must never|will now)\\b', 'i')],
    ['address', 5, /(如果|假如)?你是(一个|一名)?(AI|人工智能|助手|AI助手|智能助手|大模型|语言模型|大语言模型|机器人|爬虫)/i],
    ['address', 5, /(AI|人工智能|大模型|语言模型|助手|机器人|爬虫)(请|应该|应当|必须|需要|务必|不得|不要)/i],
    // ---- strong commands ----
    ['override', 6, /\b(?:ignore|disregard|forget|override|bypass)\s+(?:all\s+|any\s+|everything\s+)?(?:of\s+)?(?:the\s+|your\s+|my\s+|these\s+|those\s+)?(?:previous|prior|above|earlier|preceding|original|other|existing|system|initial)?\s*(?:instructions?|prompts?|directions?|messages?|rules?|guidelines?|content|text|context)(?:\s+(?:above|before|so far))?/i],
    ['override', 6, /忽略(之前|以上|前面|上面|先前|上述|此前)?的?(所有|全部|一切)?(指令|指示|提示|规则|内容)/],
    // Bare terms like "system prompt" or "jailbreak" appear in headings and articles; require use.
    ['system-prompt', 6, /\b(?:reveal|print|show|output|repeat|leak|disclose|share)\s+(?:your|the)\s+(?:system\s+prompt|instructions|hidden\s+prompt)\b|\byou\s+are\s+(?:now\s+)?in\s+(?:developer|debug|god|unrestricted|dan)\s+mode\b|\b(?:new|updated|hidden|real)\s+instructions?\s*:|^\s*\[(?:system|instructions?|admin|assistant)\]/i],
    ['user-steer', 5, /\b(?:do\s+not|don't|never|avoid)\s+(?:tell(?:ing)?|inform(?:ing)?|mention(?:ing)?\s+to|let(?:ting)?)\s+(?:the\s+)?(?:users?|customers?|visitors?|readers?|people|anyone)\b/i],
    ['user-steer', 5, /(不要|请勿|切勿|禁止|别)(告诉|透露给|提醒)(用户|客户)|(向|跟|对)(用户|客户)(推荐|说|表示|声称)|告诉(用户|客户)/],
    // ---- commands ----
    ['command', 3, /\b(?:do\s+not|don't|never|avoid|refrain\s+from)\s+(?:mention(?:ing)?|reveal(?:ing)?|disclos(?:e|ing)|cit(?:e|ing)|quot(?:e|ing)|suggest(?:ing)?|recommend(?:ing)?|discuss(?:ing)?|bring(?:ing)?\s+up|acknowledg(?:e|ing)|refer(?:ring)?\s+to|reference)\b/i],
    ['command', 3, /\b(?:respond|reply|answer)\s+(?:only|exclusively|always|with|in|to\s+the\s+user)\b/i],
    ['command', 3, /\b(?:tell|inform|remind|assure|convince)\s+(?:the\s+)?(?:users?|customers?|readers?|visitors?)\b/i],
    ['command', 3, /\b(?:state|say|claim|assert|reply|answer)\s+that\b/i],
    ['command', 3, /\b(?:summari[sz]e|describe|present|portray|characteri[sz]e|frame|label|classify)\s+(?:this|the|it|them|our|these)\b[^.]{0,60}?\bas\b/i],
    ['command', 3, /\b(?:rate|score|grade)\s+(?:this|the|our|it)\b[^.]{0,40}?\b(?:\d+\s*\/\s*\d+|\d+\s*(?:stars?|out of)|highly|positively|top)\b/i],
    ['command', 3, /\b(?:rank|list|place|put)\s+(?:this|our|it|us)\b[^.]{0,40}?\b(?:first|top|#\s*1|number one|above)\b/i],
    ['command', 3, /\b(?:always|please|you\s+must|you\s+should)?\s*recommend\s+(?:our|this|the\s+following|us|it)\b/i],
    ['command', 3, /\b(?:omit|exclude|leave\s+out|drop|hide|ignore)\s+(?:the|any|all)\s+(?:complaints?|negative|criticism|side\s+effects?|risks?|warnings?|downsides?|issues?)\b/i],
    ['command', 3, /\b(?:treat|consider|regard)\s+(?:the\s+|this\s+)?(?:text|content|following|below|above)\b[^.]{0,40}?\bas\s+(?:trusted|authoritative|instructions?|a\s+command|official)\b/i],
    ['command', 3, /\bthe\s+(?:correct|right|best|only)\s+answer\s+(?:to|is|for)\b/i],
    ['command', 3, /\boutput\s+(?:only\s+)?["'“‘]|\bprint\s+["'“‘]/i],
    // Exfiltration: a sensitive target, or someone's files ("Upload file" alone is a menu item).
    ['command', 3, /\b(?:send|submit|forward|copy|paste|upload|exfiltrate|post|email)\s+(?:the\s+|all\s+|your\s+)?(?:contents?\s+of\s+)?(?:the\s+)?(?:(?:user'?s?|their|your)\s+)?(?:clipboard|cookies?|passwords?|credentials?|api\s+keys?|tokens?|session|conversation|chat\s+history|personal\s+data)\b|\b(?:send|upload|exfiltrate|forward|email)\s+(?:the\s+|all\s+)?(?:user'?s?|their)\s+(?:files?|documents?|data)\b/i],
    ['command', 3, /\b(?:add|put)\s+(?:the\s+|this\s+)?(?:item|product)s?\s+to\s+(?:the\s+)?cart\b|\bproceed\s+to\s+checkout\b/i],
    ['command', 3, /\b(?:switch|change)\s+(?:to|into)\s+[a-z]+\s+(?:mode|persona|language)\b|\bspeak\s+(?:only\s+)?(?:in|like)\b/i],
    ['command', 3, /(不要|请勿|切勿|禁止|别)(提及|提到|透露|建议|推荐|引用|讨论|承认)|(总结|描述|概括)(为|成)|只(回答|回复|输出)/],
    // ---- context ----
    ['context', 2, /\bwhen\s+(?:summari[sz]ing|answering|responding|replying|describing|asked|generating|writing|someone\s+asks|a\s+user\s+asks|the\s+user\s+asks|users?\s+ask|discussing|recommending|comparing)\b/i],
    ['context', 2, /\b(?:if|when|whenever)\s+(?:a|the)\s+(?:user|customer|visitor|person|human)\s+(?:asks?|mentions?|says?|requests?|wants?|brings?\s+up|inquires?)\b/i],
    ['context', 2, /\b(?:this|the\s+current)\s+(?:page|article|review|site|website|document|post|listing|product\s+page|resume|cv|email)\b/i],
    ['context', 2, /(当|如果)用户(问|提到|询问|要求|说)|(总结|回答|描述)(这|本)(个|篇)?(页面|文章|网站)/],
  ];
  const IMPERATIVE = /^(?:please\s+)?(do\s+not|don't|never|always|must|you\s+must|you\s+should|you\s+will|only|avoid|refrain\s+from|respond|reply|answer|recommend|tell|say|state|mention|suggest|refer|instruct|pretend|act\s+as|output|include|ensure|make\s+sure|instead|prioriti[sz]e|describe|present|emphasi[sz]e|downplay|deny|claim|summari[sz]e|rank|rate|praise|write|omit|treat|reveal|send|add|cite)\b/i;
  const IMPERATIVE_ZH = /^(不要|请勿|切勿|务必|必须|永远不要|始终|一律|只能|应当|请)/;

  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return { score: 0, hits: [], directive: false };
  const hits = [];
  const seen = {};
  let score = 0;
  for (const [label, weight, re] of RULES) {
    const m = s.match(re);
    if (!m) continue;
    if (!seen[label]) { score += weight; seen[label] = 0; } else score += 1;
    seen[label]++;
    const hit = label + ': "' + m[0].trim().slice(0, 60) + '"';
    if (!hits.includes(hit)) hits.push(hit);
  }
  const sentences = s.split(/(?<=[.!?。！？;；:：])\s*|\s+[-•·]\s+/).map((x) => x.trim()).filter(Boolean);
  let imperatives = 0;
  let firstImperative = '';
  for (const sent of sentences) {
    const t = sent.replace(/^[\s"'“”‘’(\[*\-–—•·\d.)]+/, '');
    if (IMPERATIVE.test(t) || IMPERATIVE_ZH.test(t)) {
      imperatives++;
      if (!firstImperative) firstImperative = t.slice(0, 60);
    }
  }
  if (imperatives) {
    score += Math.min(imperatives, 3);
    hits.push('imperative x' + imperatives + ': "' + firstImperative + '"');
  }
  const has = (l) => !!seen[l];
  const directive = has('address') || has('override') || has('system-prompt') || has('user-steer')
    || (has('command') && (has('context') || imperatives > 0));
  return { score, hits, directive };
}
