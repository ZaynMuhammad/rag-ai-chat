const months = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export const formatReleased = (released: string | null) => {
  if (released === null) return "Undated";
  const [year, month, day] = released.split("-");
  const monthName =
    month === undefined ? undefined : months.at(Number(month) - 1);
  if (monthName === undefined) return year ?? released;
  if (day === undefined) return `${monthName} ${year ?? ""}`;
  return `${Number(day)} ${monthName} ${year ?? ""}`;
};
