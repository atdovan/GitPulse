<div class="app-container">
  <main class="main-content">
    <div class="analyzer-container">
      <h1>GitPulse</h1>
      <form on:submit|preventDefault={analyzeRepo}>
        <div class="input-group">
          <input 
            type="url" 
            placeholder="Paste your GitHub repository URL" 
            bind:value={repoUrl} 
            required 
            disabled={isAnalyzing}
          />
        </div>
        <div class="input-group token-group">
          <input 
            type="password" 
            placeholder="GitHub token (optional, required for private repos)" 
            bind:value={githubToken} 
            disabled={isAnalyzing}
          />
          <div class="token-info">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="16" x2="12" y2="12"></line>
              <line x1="12" y1="8" x2="12.01" y2="8"></line>
            </svg>
            <span class="tooltip">Token is only required for private repositories.</span>
          </div>
        </div>
        <button type="submit" disabled={isAnalyzing}>
          {#if isAnalyzing}
            Analyzing...
          {:else}
            Analyze Repository
          {/if}
        </button>
      </form>

      <div class="results">
        {#if error}
          <div class="error">{error}</div>
        {:else if isAnalyzing}
          <div class="loading">
            <span>Analyzing repository...</span>
          </div>
        {:else if analysis}
          <div class="analysis-section">
            <h3>General Info</h3>
            <div class="info-grid">
              <div><strong>Name:</strong> {analysis.basicInfo.name}</div>
              <div><strong>Description:</strong> {analysis.basicInfo.description || 'No description'}</div>
              <div><strong>Language:</strong> {analysis.basicInfo.language || 'N/A'}</div>
              <div><strong>Stars:</strong> {analysis.basicInfo.stars}</div>
              <div><strong>Forks:</strong> {analysis.basicInfo.forks}</div>
              <div><strong>Open Issues:</strong> {analysis.basicInfo.openIssues}</div>
            </div>
          </div>

          {#if analysis.status === 'pending'}
            <div class="loading">Performing code analysis...</div>
          {:else if analysis.status === 'completed' && analysis.fileAnalyses.length > 0}
            <div class="analysis-section code-breakthrough">
              <h3>Code Analysis Breakthrough</h3>
              {#each analysis.fileAnalyses as fileAnalysis (fileAnalysis.path)}
                <div class="file-analysis">
                  <button class="dropdown-toggle" on:click={() => (fileAnalysis.open = !fileAnalysis.open)}>
                    {fileAnalysis.path} {fileAnalysis.open ? '▼' : '▶'}
                  </button>
                  {#if fileAnalysis.open}
                    <div class="analysis-details">
                      <h4>Analysis for {fileAnalysis.path}</h4>
                      <ul>
                        <li><strong>Good:</strong>
                          <ul>
                            {#each fileAnalysis.good as point}
                              <li>{point}</li>
                            {/each}
                          </ul>
                        </li>
                        <li><strong>Bad:</strong>
                          <ul>
                            {#each fileAnalysis.bad as point}
                              <li>{point}</li>
                            {/each}
                          </ul>
                        </li>
                        <li><strong>Improvements:</strong>
                          <ul>
                            {#each fileAnalysis.improvements as point}
                              <li>{point}</li>
                            {/each}
                          </ul>
                        </li>
                      </ul>
                      {#if fileAnalysis.deepAnalysisPending}
                        <button class="deep-analysis-btn" on:click={() => deepAnalyze(fileAnalysis.path)}>
                          Continue Deeper Analysis
                        </button>
                      {/if}
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          {:else if analysis.status === 'failed'}
            <div class="error">Code analysis failed. Please try again later.</div>
          {/if}
        {:else}
          <p>Enter a GitHub repository URL to begin analysis</p>
        {/if}
      </div>
    </div>
  </main>
</div>

<script lang="ts">
  import { onDestroy } from 'svelte';

  interface Analysis {
    basicInfo: {
      name: string;
      description: string | null;
      stars: number;
      forks: number;
      openIssues: number;
      language: string | null;
      isPrivate: boolean;
    };
    fileAnalyses: {
      path: string;
      good: string[];
      bad: string[];
      improvements: string[];
      deepAnalysisPending: boolean;
      open?: boolean;
    }[];
    suggestions: string[];
    vulnerabilities: string[];
    status: 'pending' | 'completed' | 'failed';
  }

  let repoUrl = '';
  let githubToken = '';
  let isAnalyzing = false;
  let error: string | null = null;
  let analysis: Analysis | null = null;
  let pollingInterval: NodeJS.Timeout | null = null;

  async function analyzeRepo() {
    isAnalyzing = true;
    error = null;
    analysis = null;
    if (pollingInterval) clearInterval(pollingInterval);

    try {
      console.log('Sending request to /api/analyze:', { repoUrl, token: githubToken });
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl, token: githubToken || undefined }),
      });
      console.log('Response status:', response.status);

      const text = await response.text(); // Get raw text first
      console.log('Raw response:', text);

      const result = JSON.parse(text); // Parse JSON
      if (!response.ok) {
        throw new Error(result.error || `Server returned ${response.status}`);
      }

      analysis = result as Analysis;
      analysis.fileAnalyses.forEach(file => (file.open = false));

      if (analysis.status === 'pending') {
        pollingInterval = setInterval(checkAnalysisStatus, 2000);
      }
    } catch (e) {
      console.error('Fetch error:', e);
      error = e instanceof Error ? e.message : 'An unknown error occurred';
    } finally {
      isAnalyzing = false; // Ensure this runs even on error
      console.log('Analysis complete, isAnalyzing:', isAnalyzing);
    }
  }

  async function checkAnalysisStatus() {
    if (!repoUrl || !analysis || analysis.status !== 'pending') return;

    try {
      console.log('Polling /api/analyze/status...');
      const response = await fetch('/api/analyze/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Status check failed');

      analysis = result as Analysis;
      analysis.fileAnalyses.forEach(file => (file.open = file.open || false));

      if (analysis.status !== 'pending' && pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
        console.log('Polling stopped');
      }
    } catch (e) {
      console.error('Status check error:', e);
      error = e instanceof Error ? e.message : 'Status check failed';
    }
  }

  async function deepAnalyze(filePath: string) {
    if (!analysis) return;
    const file = analysis.fileAnalyses.find(f => f.path === filePath);
    if (!file || !file.deepAnalysisPending) return;

    try {
      const response = await fetch('/api/analyze/deep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl, token: githubToken, filePath }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Deep analysis failed');

      file.good = result.good || file.good;
      file.bad = result.bad || file.bad;
      file.improvements = result.improvements || file.improvements;
      file.deepAnalysisPending = false;
    } catch (e) {
      console.error('Deep analysis error:', e);
      error = e instanceof Error ? e.message : 'Deep analysis failed';
    }
  }

  onDestroy(() => {
    if (pollingInterval) clearInterval(pollingInterval);
  });
</script>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    background-color: #0f0f0f;
    color: #ffffff;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  }

  .app-container {
    display: flex;
    min-height: 100vh;
    background-color: #0f0f0f;
  }

  .main-content {
    flex-grow: 1;
    background-color: #0f0f0f;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start; /* Changed to flex-start to push content up */
    padding: 1rem; /* Reduced padding for more room */
  }

  .analyzer-container {
    width: 100%;
    max-width: 768px;
    margin: 0 auto;
    padding: 0 1rem;
  }

  h1 {
    font-size: 2rem;
    font-weight: 600;
    margin-bottom: 1rem; /* Reduced margin for closer placement */
    color: #ececf1;
    text-align: center;
  }

  .input-group {
    position: relative;
    margin-bottom: 1rem;
    width: 100%;
  }

  .token-group {
    position: relative;
    width: 100%;
  }

  input {
    width: 100%;
    padding: 1rem;
    background-color: #1a1a1a;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    color: #fff;
    font-size: 1rem;
    transition: all 0.3s ease;
    box-sizing: border-box;
  }

  input:focus {
    outline: none;
    border-color: #333;
    box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.05);
  }

  input::placeholder {
    color: rgba(255, 255, 255, 0.5);
  }

  button {
    width: 100%;
    padding: 0.75rem 1rem;
    background-color: #1a1a1a;
    color: white;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    font-size: 1rem;
    font-weight: 500;
    cursor: pointer;
    transition: background-color 0.2s ease;
    box-sizing: border-box;
  }

  button:hover {
    background-color: #333;
  }

  .results {
    margin-top: 1.5rem; /* Reduced margin for more room */
    padding: 1.5rem;
    background-color: #1a1a1a;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    width: 100%;
    max-width: 500px;
    margin-left: auto;
    margin-right: auto;
    text-align: center;
  }

  .results p {
    color: rgba(255, 255, 255, 0.8);
    font-size: 0.9rem;
    line-height: 1.5;
    margin: 0;
  }

  .analysis-section {
    margin-top: 1.5rem;
    text-align: left;
  }

  .analysis-section h3 {
    color: #ececf1;
    font-size: 1.1rem;
    margin-bottom: 0.5rem;
  }

  .info-grid {
    display: grid;
    grid-template-columns: 1fr; /* Single column for now, can adjust to 2 columns later if needed */
    gap: 0.5rem;
    color: rgba(255, 255, 255, 0.8);
  }

  .info-grid div {
    padding: 0.25rem 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .info-grid div:last-child {
    border-bottom: none;
  }

  .code-breakthrough {
    margin-top: 2rem; /* Extra space for this section */
    padding: 1.5rem;
    background-color: #1a1a1a;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.1);
  }

  .analysis-list {
    list-style: none;
    padding: 0;
    margin: 0;
    margin-top: 1rem;
  }

  .analysis-list li {
    padding: 0.5rem 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .analysis-list li:last-child {
    border-bottom: none;
  }

  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    color: #888;
  }

  .error {
    color: #ff4444;
    padding: 1rem;
    border: 1px solid rgba(255, 68, 68, 0.3);
    border-radius: 4px;
    margin-top: 1rem;
  }

  .token-info {
    position: absolute;
    right: 12px;
    top: 50%;
    transform: translateY(-50%);
    color: #888;
    cursor: help;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .token-info:hover .tooltip {
    display: block;
  }

  .token-info svg {
    display: block;
  }

  .token-group input {
    padding-right: calc(40px + 1rem);
  }

  .tooltip {
    display: none;
    position: absolute;
    bottom: 100%;
    right: -10px;
    transform: none;
    padding: 0.75rem;
    background-color: #333;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    width: 200px;
    font-size: 0.8rem;
    margin-bottom: 0.5rem;
    text-align: left;
    z-index: 100;
    line-height: 1.4;
  }

  .tooltip::after {
    content: '';
    position: absolute;
    top: 100%;
    right: 13px;
    border-width: 5px;
    border-style: solid;
    border-color: #333 transparent transparent transparent;
  }

  .file-analysis {
    margin-bottom: 1rem;
  }

  .dropdown-toggle {
    width: 100%;
    padding: 0.75rem;
    background-color: #1a1a1a;
    color: white;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    font-size: 1rem;
    font-weight: 500;
    cursor: pointer;
    transition: background-color 0.2s ease;
    text-align: left;
  }

  .dropdown-toggle:hover {
    background-color: #333;
  }

  .analysis-details {
    margin-top: 0.5rem;
    padding: 1rem;
    background-color: #222;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.1);
  }

  .deep-analysis-btn {
    margin-top: 1rem;
    padding: 0.5rem 1rem;
    background-color: #1a1a1a;
    color: white;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    font-size: 0.9rem;
    cursor: pointer;
    transition: background-color 0.2s ease;
  }

  .deep-analysis-btn:hover {
    background-color: #333;
  }
</style>
