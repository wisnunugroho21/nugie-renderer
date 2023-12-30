#include "input_raygen_desc_set.hpp"
#include "../../../vulkan/descriptor/descriptor_writer.hpp"

namespace NugieApp {
  InputRayGenDescSet::InputRayGenDescSet(NugieVulkan::Device* device, NugieVulkan::DescriptorPool* descriptorPool,
		std::vector<VkDescriptorImageInfo> inputImageInfo[4])
		: device{device}, descriptorPool{descriptorPool} 
	{
		this->createDescriptorLayout();
		this->createDescriptorSet(inputImageInfo);
  }

	InputRayGenDescSet::~InputRayGenDescSet() {
		if (this->descSetLayout != nullptr) delete this->descSetLayout;
	}

	void InputRayGenDescSet::createDescriptorLayout() {
		this->descSetLayout = 
			NugieVulkan::DescriptorSetLayout::Builder(this->device)
				.addBinding(0, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, VK_SHADER_STAGE_COMPUTE_BIT)
				.addBinding(1, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, VK_SHADER_STAGE_COMPUTE_BIT)
				.addBinding(2, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, VK_SHADER_STAGE_COMPUTE_BIT)
				.addBinding(3, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, VK_SHADER_STAGE_COMPUTE_BIT)
				.build();
	}

  void InputRayGenDescSet::createDescriptorSet(std::vector<VkDescriptorImageInfo> inputImageInfo[4]) 
	{	
		auto y = inputImageInfo;
		auto z = inputImageInfo[0];
		auto n = inputImageInfo[3];

		this->descriptorSets.clear();
		for (int i = 0; i < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT; i++) {
			VkDescriptorSet descSet;

			auto x = NugieVulkan::DescriptorWriter(this->device, this->descSetLayout, this->descriptorPool)
				.writeImage(0, inputImageInfo[0][i])
				.writeImage(1, inputImageInfo[1][i])
				.writeImage(2, inputImageInfo[2][i])
				.writeImage(3, inputImageInfo[3][i])
				.build(&descSet);
			
			this->descriptorSets.emplace_back(descSet);
		}
  }

	void InputRayGenDescSet::overwrite(std::vector<VkDescriptorImageInfo> inputImageInfo[4]) 
	{
		for (size_t i = 0; i < this->descriptorSets.size(); i++) {
			NugieVulkan::DescriptorWriter(this->device, this->descSetLayout, this->descriptorPool)
				.writeImage(0, inputImageInfo[0][i])
				.writeImage(1, inputImageInfo[1][i])
				.writeImage(2, inputImageInfo[2][i])
				.writeImage(3, inputImageInfo[3][i])
				.overwrite(&this->descriptorSets[i]);
		}
	}
}