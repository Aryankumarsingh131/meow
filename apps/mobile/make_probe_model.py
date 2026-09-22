"""Generate the fixed identity model used only to prove offline native inference."""

from pathlib import Path

import onnx
from onnx import TensorProto, helper


value = helper.make_tensor_value_info("input", TensorProto.FLOAT, [1, 2])
result = helper.make_tensor_value_info("output", TensorProto.FLOAT, [1, 2])
graph = helper.make_graph([helper.make_node("Identity", ["input"], ["output"])], "probe", [value], [result])
model = helper.make_model(graph, opset_imports=[helper.make_operatorsetid("", 13)], ir_version=8)
onnx.checker.check_model(model)
Path(__file__).with_name("assets").joinpath("identity.onnx").write_bytes(model.SerializeToString())
