import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useState } from "react";

function RelationshipExample() {
  const [worked, setWorked] = useState(false);
  const test = useMutation(api.relationshipsExample.relationshipTest);
  return (
    <div>
      <h2>Relationship Test</h2>
      {worked ? (
        <div>Worked!</div>
      ) : (
        <button onClick={() => test({}).then(setWorked)}>Test</button>
      )}
    </div>
  );
}
export default RelationshipExample;
