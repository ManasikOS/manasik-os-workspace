import React from "react";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbSeparator,
  BreadcrumbPage,
} from "./ui/breadcrumb";

interface PageHeaderProps {
  title: string;
  breadcrumb: { title: string; link: string }[];
  action: React.ReactNode;
  /** A plain string still works — ReactNode so a caller can embed a link (e.g. "From: <package>"). */
  subTitle?: React.ReactNode;
}

const PageHeader = ({
  title,
  breadcrumb,
  action,
  subTitle,
}: PageHeaderProps) => {
  return (
    <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-5">
      <div className="flex flex-col">
        <Breadcrumb className="">
          <BreadcrumbList>
            {breadcrumb.map((item, index) => (
              <React.Fragment key={index}>
                <BreadcrumbItem>
                  <BreadcrumbLink render={<a href={item.link} />}>
                    {item.title}
                  </BreadcrumbLink>
                </BreadcrumbItem>
                {index < breadcrumb.length - 1 && <BreadcrumbSeparator />}
              </React.Fragment>
            ))}
          </BreadcrumbList>
        </Breadcrumb>
        <h2 className="text-3xl mt-1 font-semibold tracking-tight">{title}</h2>
        {subTitle && (
          <p className="text-muted-foreground mt-2 text-sm">{subTitle}</p>
        )}
      </div>
      {action && action}
    </div>
  );
};

export default PageHeader;
