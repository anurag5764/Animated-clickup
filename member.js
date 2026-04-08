import dotenv from 'dotenv';
import axios from 'axios';
import fs from 'fs';

dotenv.config();

const API_TOKEN = process.env.CLICKUP_API_TOKEN;
const headers = { Authorization: API_TOKEN };

// --- TEAM CONFIGURATIONS ---
const TEAMS = [
  {
    name: 'PS',
    outputFile: 'members_tasks_ps.json',
    assignees: [
      "Sayantan Dey",
      "sumon",
      "Sai krishna (Deactivated)",
      "Vinayak Agrawal",
      "Kumaresh Dhotrad",
      "Sarat Anumula",
      "Tomin Jose",
      "Arunashish Datta",
      "Shiva Teja",
      "Anish Saha",
      "Deepthi Kammath",
      "Ashutosh Nahar"
    ]
  },
  {
    name: 'AMS',
    outputFile: 'members_tasks_ams.json',
    assignees: [
      "Subodh Kumar",
      "Shovan Maity",
      "sumon",
      "Ebin Abraham",
      "Anirudh Roy (Deactivated)",
      "Aniruddh Choudhary",
      "Sayemul Islam",
      "Arka Chowdhury",
      "Gulshan Poddar",
      "KiritkumarP",
      "hareesh th",
      "Irappa Bagodi",
      "Ayash Ashraf",
      "Manash Dey",
      "Samanway Pal"
    ]
  },
  {
    name: 'RTL',
    outputFile: 'members_tasks_rtl.json',
    assignees: [
      "Sayantan Dey",
      "sumon",
      "Anirudh Roy (Deactivated)",
      "Arka Chakraborty",
      "Abhishek Sarkar",
      "Vinayak Agrawal",
      "Souptik Dolui",
      "Arka Chowdhury",
      "Ushasi Das",
      "Robert Tucker Swan",
      "Archisman Ghosh",
      "Sharanya Shetty",
      "Charles Adeyanju",
      "Manash Dey",
      "Himanshu Shaw",
      "Manav",
      "Dheerajeswar Saluru",
      "Anish Saha"
    ]
  }
];

// Filter statuses considered "in progress"
const TARGET_STATUSES = ['in progress', 'inprogress'];

// Step 1: Get all members
async function getMembers() {
  const res = await axios.get('https://api.clickup.com/api/v2/team', { headers });
  const team = res.data.teams[0];
  console.log(`Workspace: ${team.name}`);
  console.log(`Total Members: ${team.members.length}`);
  return { team, members: team.members };
}

// Step 2: Get tasks assigned to a specific member (with pagination)
async function getTasksForMember(teamId, memberId) {
  let allTasks = [];
  let page = 0;

  while (true) {
    const res = await axios.get(
      `https://api.clickup.com/api/v2/team/${teamId}/task?assignees[]=${memberId}&include_closed=true&page=${page}`,
      { headers }
    );
    const tasks = res.data.tasks;
    if (!tasks || tasks.length === 0) break;
    allTasks = [...allTasks, ...tasks];
    if (tasks.length < 100) break;
    page++;
  }

  return allTasks;
}

// Step 3: Get comments for a task
async function getTaskComments(taskId) {
  try {
    const res = await axios.get(
      `https://api.clickup.com/api/v2/task/${taskId}/comment`,
      { headers }
    );
    return res.data.comments.map(c => ({
      commentBy: c.user?.username || 'Unknown',
      comment: c.comment_text,
      date: c.date ? new Date(parseInt(c.date)).toLocaleDateString() : null,
    }));
  } catch (err) {
    return [];
  }
}

// Step 4: Get full task details (description)
async function getTaskDetails(taskId) {
  try {
    const res = await axios.get(
      `https://api.clickup.com/api/v2/task/${taskId}`,
      { headers }
    );
    return res.data.description || '';
  } catch (err) {
    return '';
  }
}

// Process a single team config
async function processTeam(teamConfig, teamId, allMembers) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  Processing Team: ${teamConfig.name}`);
  console.log(`${'='.repeat(60)}`);

  const targetAssignees = teamConfig.assignees;

  const membersToProcess = targetAssignees.length > 0
    ? allMembers.filter(m =>
        targetAssignees.includes(m.user.username) ||
        targetAssignees.includes(m.user.email)
      )
    : allMembers;

  const result = [];
  let grandTotalTasks = 0;

  for (const member of membersToProcess) {
    const user = member.user;
    console.log(`\nFetching tasks for: ${user.username}`);

    let tasks = await getTasksForMember(teamId, user.id);

    // Filter tasks based on TARGET_STATUSES
    if (TARGET_STATUSES.length > 0) {
      tasks = tasks.filter(task => {
        const statusName = task.status?.status?.toLowerCase() || '';
        const normalizedStatus = statusName.replace(/[-\s]/g, '');
        const normalizedTargets = TARGET_STATUSES.map(s => s.toLowerCase().replace(/[-\s]/g, ''));
        return normalizedTargets.includes(normalizedStatus);
      });
    }

    grandTotalTasks += tasks.length;

    const detailedTasks = [];

    for (const task of tasks) {
      console.log(`  → Fetching details for task: ${task.name}`);

      const [description, comments] = await Promise.all([
        getTaskDetails(task.id),
        getTaskComments(task.id),
      ]);

      detailedTasks.push({
        taskId: task.id,
        name: task.name,
        description: description,
        status: task.status?.status,
        dueDate: task.due_date
          ? new Date(parseInt(task.due_date)).toLocaleDateString()
          : null,
        priority: task.priority?.priority,
        listName: task.list?.name,
        totalComments: comments.length,
        comments: comments,
      });
    }

    result.push({
      id: user.id,
      username: user.username,
      email: user.email,
      totalTasks: tasks.length,
      tasks: detailedTasks,
    });

    console.log(`  ✅ ${tasks.length} tasks done for ${user.username}`);
  }

  // Save to team-specific JSON file
  fs.writeFileSync(teamConfig.outputFile, JSON.stringify(result, null, 2));
  console.log(`\n✅ ${teamConfig.name} Team Done! Total tasks: ${grandTotalTasks}`);
  console.log(`📁 Data saved to ${teamConfig.outputFile}`);

  return grandTotalTasks;
}

// Main function
async function main() {
  try {
    const { team, members } = await getMembers();
    const teamId = team.id;

    let totalAllTeams = 0;

    for (const teamConfig of TEAMS) {
      const count = await processTeam(teamConfig, teamId, members);
      totalAllTeams += count;
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`  🎉 ALL TEAMS DONE! Grand total tasks: ${totalAllTeams}`);
    console.log(`${'='.repeat(60)}`);

  } catch (err) {
    console.error('Error:', err.response?.data || err.message);
  }
}

main();