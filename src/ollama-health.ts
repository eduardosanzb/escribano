/**
 * Escribano - Ollama Health Check
 *
 * Validates Ollama is running and accessible
 */

async function checkOllamaHealth(): Promise<void> {
  try {
    const response = await fetch('http://localhost:11434/api/tags');

    if (!response.ok) {
      throw new Error('Ollama API not accessible');
    }

    const data = await response.json();
    console.log('✓ Ollama is running and accessible');
    console.log(`  Available models: ${data.models?.length || 0}`);
  } catch (error) {
    console.error('✗ Ollama is not running or not accessible');
    console.error('  Error:', (error as Error).message);
    console.error('');
    console.error('Please start Ollama:');
    console.error('  brew install ollama');
    console.error('  ollama pull qwen3:32b');
    console.error('  ollama serve');
    console.error('');
    throw new Error('Ollama service required for classification');
  }
}

export { checkOllamaHealth };
