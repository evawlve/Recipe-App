import fetch from 'node-fetch';

async function testOpenRouter() {
  const url = 'https://openrouter.ai/api/v1/chat/completions';
  const apiKey = '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';
  
  console.log('Testing OpenRouter...');
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'qwen/qwen-turbo',
      messages: [{role: 'user', content: 'hello'}]
    })
  });
  
  console.log('Status:', response.status);
  const text = await response.text();
  console.log('Body:', text);
}

testOpenRouter().catch(console.error);
