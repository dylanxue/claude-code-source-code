type QuestionHost = {
  question: (prompt: string) => Promise<string>
}

let activeQuestionHost: QuestionHost | null = null

export function registerInteractiveQuestionHost(host: QuestionHost): () => void {
  activeQuestionHost = host

  return () => {
    if (activeQuestionHost === host) {
      activeQuestionHost = null
    }
  }
}

export function getInteractiveQuestionHost(): QuestionHost | null {
  return activeQuestionHost
}
