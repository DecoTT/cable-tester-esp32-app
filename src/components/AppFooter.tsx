
import React from 'react';

const AppFooter: React.FC = () => {
  return (
    <div className="bg-white rounded-lg shadow-lg p-4">
      <div className="text-center text-sm text-gray-600">
        © {new Date().getFullYear()} <a 
          href="https://sbcgroup.com.mx/" 
          target="_blank" 
          rel="noopener noreferrer"
          className="text-blue-600 hover:text-blue-800 underline"
        >
          SBC Group
        </a>
      </div>
    </div>
  );
};

export default AppFooter;
