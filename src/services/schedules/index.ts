const PUBLISHED_SCHEDULE = {
  version: 7,
  publishedAt: "2026-10-04T08:00:00.000Z",
  semesterLabel: "1st Semester, A.Y. 2026-2027",
  sections: ["BSIT 3-A"],
  schedules: [
    {
      id: "sched-001",
      subject: "Information Assurance and Security",
      code: "IAS101",
      instructor: "Mr. Juan dela Cruz",
      room: "Lab 301",
      days: ["Monday", "Wednesday", "Friday"],
      startTime: "07:30",
      endTime: "09:00",
      section: "BSIT 3-A",
      units: 3,
    },
    {
      id: "sched-002",
      subject: "Applications Development and Emerging Technologies",
      code: "ADET101",
      instructor: "Ms. Maria Santos",
      room: "Lab 302",
      days: ["Monday", "Wednesday", "Friday"],
      startTime: "09:00",
      endTime: "10:30",
      section: "BSIT 3-A",
      units: 3,
    },
    {
      id: "sched-003",
      subject: "Integrative Programming and Technologies",
      code: "IPT101",
      instructor: "Mr. Carlos Reyes",
      room: "Room 201",
      days: ["Monday", "Wednesday", "Friday"],
      startTime: "10:30",
      endTime: "12:00",
      section: "BSIT 3-A",
      units: 3,
    },
    {
      id: "sched-004",
      subject: "Social and Professional Issues",
      code: "SPI101",
      instructor: "Dr. Ana Flores",
      room: "Room 101",
      days: ["Tuesday", "Thursday"],
      startTime: "13:00",
      endTime: "14:30",
      section: "BSIT 3-A",
      units: 3,
    },
    {
      id: "sched-005",
      subject: "Technopreneurship",
      code: "TECH101",
      instructor: "Mr. Roberto Lim",
      room: "Room 102",
      days: ["Tuesday", "Thursday"],
      startTime: "14:30",
      endTime: "16:00",
      section: "BSIT 3-A",
      units: 3,
    },
    {
      id: "sched-006",
      subject: "Physical Education 3",
      code: "PE103",
      instructor: "Coach Pedro Bautista",
      room: "Gymnasium",
      days: ["Friday"],
      startTime: "14:00",
      endTime: "16:00",
      section: "BSIT 3-A",
      units: 2,
    },
  ],
};

export const getPublishedScheduleService = async (_userId: string) => {
  try {
    return {
      code: 200,
      status: "success",
      data: {
        schedule: PUBLISHED_SCHEDULE,
      },
    };
  } catch (error) {
    console.error("getPublishedScheduleService Error:", error);
    return { code: 500, status: "error", message: "Failed to fetch schedule" };
  }
};
