export type WorkspaceMode = 'code' | 'work'

export const workSkills = [
    {name: 'Decision brief', matches: /\b(?:brief|recommendation)\b|决策|简报/i, starter: 'Prepare a decision brief using the materials in this folder. ', guidance: 'Identify the decision and audience, compare viable options against explicit criteria, cite the source files, and close with a recommendation and unresolved questions.'},
    {name: 'Data analysis', matches: /\b(?:table|csv|spreadsheet|dataset|data analysis)\b|表格|数据分析|电子表格/i, starter: 'Analyze a table in this folder and summarize the most important findings. ', guidance: 'Inspect headers, units, missing values and duplicates. Show the calculation behind each key figure and reconcile totals. Save requested tabular output as CSV.'},
    {name: 'Presentation outline', matches: /\b(?:presentation|slides?|deck|pptx?)\b|演示|幻灯片/i, starter: 'Turn the source material in this folder into a presentation outline. ', guidance: 'Design the narrative for the intended audience. Give each slide one takeaway, supporting evidence and speaker notes. Attribute figures to their source.'},
    {name: 'Meeting follow-up', matches: /\b(?:meeting|minutes)\b|会议|纪要/i, starter: 'Turn my meeting notes into decisions and an action list. ', guidance: 'Separate decisions, proposals and open questions. Record action owners and due dates only when supported by the notes. Mark missing assignments explicitly.'},
] as const

export function workSkillPrompt(task: string) {
    const matched = workSkills.filter(skill => skill.matches.test(task))
    const skills = matched.length ? matched : workSkills
    return skills.map(skill => `${skill.name}: ${skill.guidance}`).join('\n')
}
