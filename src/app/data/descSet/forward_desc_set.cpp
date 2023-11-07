#include "forward_desc_set.hpp"
#include "../../../vulkan/descriptor/descriptor_writer.hpp"

namespace NugieApp {
  ForwardDescSet::ForwardDescSet(NugieVulkan::Device* device, NugieVulkan::DescriptorPool* descriptorPool,
		std::vector<VkDescriptorBufferInfo> uniformBufferInfo, VkDescriptorBufferInfo modelsInfo[2]) 
	{
		this->createDescriptor(device, descriptorPool, uniformBufferInfo, modelsInfo);
  }

	ForwardDescSet::~ForwardDescSet() {
		if (this->descSetLayout != nullptr) delete this->descSetLayout;
	}

  void ForwardDescSet::createDescriptor(NugieVulkan::Device* device, NugieVulkan::DescriptorPool* descriptorPool,
		std::vector<VkDescriptorBufferInfo> uniformBufferInfo, VkDescriptorBufferInfo modelsInfo[2]) 
	{
    this->descSetLayout = 
			NugieVulkan::DescriptorSetLayout::Builder(device)
				.addBinding(0, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_VERTEX_BIT)
				.addBinding(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_VERTEX_BIT)
				.addBinding(2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_FRAGMENT_BIT)
				.build();
		
	this->descriptorSets.clear();
		for (int i = 0; i < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT; i++) {
			VkDescriptorSet descSet;

			auto x = NugieVulkan::DescriptorWriter(device, this->descSetLayout, descriptorPool)
				.writeBuffer(0, uniformBufferInfo[i])
				.writeBuffer(1, modelsInfo[0])
				.writeBuffer(2, modelsInfo[1])
				.build(&descSet);

			auto z = x;

			this->descriptorSets.emplace_back(descSet);
		}
  }
}