import { useMemo, useCallback } from 'react'
import { useChatStore } from '@/stores/chatStore'

const QUICK_QUESTIONS = [
  // Focus & Priorities
  "What should I be focusing on right now based on my notes?",
  "What are the most important unresolved items across my vault?",
  "Which tasks or topics keep coming up but haven't been acted on?",
  "What's the biggest open question I haven't answered yet?",
  "What did I say I would do next, and have I done it?",

  // Insights & Patterns
  "What patterns or themes are emerging across my notes?",
  "Are there any contradictions or tensions in my thinking?",
  "What ideas have I revisited the most?",
  "What connections am I missing between different topics?",
  "What's changed in my thinking compared to earlier notes?",

  // Planning & Progress
  "Summarize my current progress on ongoing projects.",
  "What are the gaps between my goals and my recent activity?",
  "Which projects have stalled and why?",
  "What would make the biggest difference this week?",
  "What decisions have I been putting off?",

  // Knowledge & Research
  "What do I actually know about this topic based on my notes?",
  "Where are the gaps in my research?",
  "What questions should I be investigating that I haven't yet?",
  "Which sources or references appear most often in my notes?",
  "What have I learned recently that changed my perspective?",

  // Writing & Output
  "What's ready to be turned into a written piece or document?",
  "Which ideas are well-developed enough to share?",
  "What raw thoughts need to be refined and structured?",
  "Are there recurring arguments I keep making across different notes?",
  "What's the clearest thing I've written on this topic?",

  // Reflection & Review
  "What worked well recently, based on my notes?",
  "What should I do differently going forward?",
  "What assumptions am I making that I haven't questioned?",
  "Are there any ideas I abandoned that are worth revisiting?",
  "What's still unclear or unresolved in my thinking?",

  // Productivity & Workflow
  "What recurring bottlenecks show up in my work?",
  "Which parts of my workflow could be simplified or eliminated?",
  "Where am I spending time that doesn't seem to lead anywhere?",
  "What habits or systems have I mentioned wanting to build?",
  "What tools or approaches have I noted as helpful?",

  // Goals & Direction
  "What are my stated goals and how am I tracking against them?",
  "Is what I'm working on aligned with what I said matters most?",
  "What would I need to believe to change direction on this?",
  "What does success look like based on my notes?",
  "What am I optimizing for, and is it the right thing?",
]

const BTN_STYLE: React.CSSProperties = {
  background: 'var(--color-bg-secondary)',
  color: 'var(--color-text-secondary)',
  border: '1px solid var(--color-border)',
}

export default function QuickQuestions() {
  const sendMessage = useChatStore(s => s.sendMessage)
  const question = useMemo(
    () => QUICK_QUESTIONS[Math.floor(Math.random() * QUICK_QUESTIONS.length)],
    []
  )
  const handleClick = useCallback(() => sendMessage(question), [sendMessage, question])

  return (
    <div className="flex justify-center" data-testid="quick-questions">
      <button
        onClick={handleClick}
        data-testid="quick-q-0"
        className="text-xs px-2.5 py-1 rounded-full transition-colors hover:opacity-80"
        style={BTN_STYLE}
      >
        {question}
      </button>
    </div>
  )
}
